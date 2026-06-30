/**
 * 动态端口开发启动脚本
 *
 * 让 Vite 自动分配空闲端口，然后以正确的 devUrl 启动 Tauri dev。
 * 解决了端口被占用时需要手动改配置的问题。
 *
 * 用法: npm run tauri:dev
 */

import { spawn } from "child_process";
import { writeFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

let cleanupTasks = [];

function cleanup() {
  for (const task of cleanupTasks) {
    try {
      task();
    } catch {
      // 忽略清理错误
    }
  }
}

process.on("SIGINT", () => {
  cleanup();
  process.exit(0);
});
process.on("SIGTERM", () => {
  cleanup();
  process.exit(0);
});
process.on("exit", cleanup);

async function main() {
  // 1. 启动 Vite，从 1742 开始自动递增找空端口
  const vite = spawn(
    "npx",
    ["vite", "--port", "1742"],
    {
      cwd: ROOT,
      stdio: ["pipe", "pipe", "pipe"],
      shell: true,
    }
  );

  let port = null;
  let tauriProcess = null;
  let outputBuffer = "";

  // 合并处理 stdout 和 stderr，因为 Vite 的启动信息可能输出到 stderr
  function handleOutput(data) {
    const text = data.toString();
    outputBuffer += text;
    process.stdout.write(text);

    // 从 Vite 输出中提取实际端口号
    // 输出格式: ➜  Local:   http://localhost:XXXX/
    // 去掉 ANSI 颜色转义码后再匹配
    const clean = outputBuffer.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
    const match = clean.match(/Local:\s+http:\/\/localhost:(\d+)/);
    if (match && !port) {
      port = parseInt(match[1], 10);
      console.log(`[dev] Vite 已就绪 (端口: ${port})，启动 Tauri...`);

      // 2. 写入临时 Tauri 配置覆盖文件（跳过 beforeDevCommand，避免重复启动 Vite）
      const configOverride = JSON.stringify({
        build: {
          devUrl: `http://localhost:${port}`,
          beforeDevCommand: "echo",
        },
      });
      const configPath = join(tmpdir(), `tauri-dev-config-${Date.now()}.json`);
      writeFileSync(configPath, configOverride, "utf-8");
      cleanupTasks.push(() => {
        try {
          unlinkSync(configPath);
        } catch {
          // 文件可能已被删除
        }
      });

      // 3. 启动 Tauri dev
      tauriProcess = spawn(
        "npx",
        ["tauri", "dev", "--config", configPath],
        {
          cwd: ROOT,
          stdio: "inherit",
          shell: true,
        }
      );

      tauriProcess.on("exit", (code) => {
        vite.kill();
        cleanup();
        process.exit(code ?? 0);
      });
    }
  }

  vite.stdout.on("data", handleOutput);
  vite.stderr.on("data", handleOutput);

  vite.on("exit", (code) => {
    if (tauriProcess) {
      tauriProcess.kill();
    } else if (code !== 0) {
      console.error(`[dev] Vite 异常退出 (code: ${code})`);
      cleanup();
      process.exit(code ?? 1);
    }
  });

  // 4. 超时保护
  setTimeout(() => {
    if (!port) {
      console.error("[dev] Vite 启动超时（30秒）");
      vite.kill();
      cleanup();
      process.exit(1);
    }
  }, 30000);
}

main().catch((err) => {
  console.error("[dev] 启动失败:", err);
  cleanup();
  process.exit(1);
});
