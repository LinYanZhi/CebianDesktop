/**
 * 工作区文件管理
 *
 * CebianDesktop 的文件式工作区：
 *   app_data_dir/workspace/prompts/  — 提示词 (.md 文件，带 frontmatter)
 *   app_data_dir/workspace/skills/   — 技能 (.md 文件，带 frontmatter)
 *
 * 每个 .md 文件格式：
 *   ---
 *   name: my-prompt
 *   description: Does something
 *   created_at: 1700000000
 *   updated_at: 1700000000
 *   ---
 *   body content here
 */

import { invoke } from "@tauri-apps/api/core";

/** 工作区文件 */
export interface WorkspaceFile {
  filename: string;
  id: string;
  name: string;
  description: string;
  content: string;
  created_at: number;
  updated_at: number;
}

/** 工作区子目录 */
export type WorkspaceSubDir = "prompts" | "skills";

/** 列出子目录下的所有文件 */
export async function listWorkspaceFiles(sub: WorkspaceSubDir): Promise<WorkspaceFile[]> {
  return invoke("list_workspace_files", { sub });
}

/** 读取文件 */
export async function readWorkspaceFile(sub: WorkspaceSubDir, id: string): Promise<WorkspaceFile> {
  return invoke("read_workspace_file", { sub, id });
}

/** 写入文件（创建或更新） */
export async function writeWorkspaceFile(
  sub: WorkspaceSubDir,
  id: string,
  name: string,
  description: string,
  content: string,
): Promise<void> {
  return invoke("write_workspace_file", { sub, id, name, description, content });
}

/** 删除文件 */
export async function deleteWorkspaceFile(sub: WorkspaceSubDir, id: string): Promise<void> {
  return invoke("delete_workspace_file", { sub, id });
}

/** 重命名文件（实际重命名磁盘上的 .md 文件，newName 不含扩展名） */
export async function renameWorkspaceFile(sub: WorkspaceSubDir, id: string, newName: string): Promise<void> {
  return invoke("rename_workspace_file", { sub, id, newName });
}

/** 生成新 ID */
export async function generateWorkspaceId(): Promise<string> {
  return invoke("generate_workspace_id");
}

/** 导出单个工作区文件（返回原始 Markdown 内容字符串） */
export async function exportWorkspaceFileContent(sub: WorkspaceSubDir, id: string): Promise<string> {
  return invoke("export_workspace_file", { sub, id });
}

/** 导入单个工作区文件（传入原始 Markdown 内容），返回新文件 id */
export async function importWorkspaceFileContent(sub: WorkspaceSubDir, content: string): Promise<string> {
  return invoke("import_workspace_file", { sub, content });
}

/** 导出备份（返回 base64 字符串） */
export async function exportBackup(): Promise<string> {
  return invoke("export_backup");
}

/** 导入备份（从 base64 字符串） */
export async function importBackup(data: string): Promise<void> {
  return invoke("import_backup", { data });
}

/** 在文件管理器中打开工作区子目录 */
export async function openWorkspaceDir(sub: WorkspaceSubDir): Promise<string> {
  return invoke("open_workspace_dir", { sub });
}

/** 在工作区子目录下创建子文件夹 */
export async function createWorkspaceSubdir(sub: WorkspaceSubDir, dirName: string): Promise<void> {
  return invoke("create_workspace_subdir", { sub, dirName });
}

/** 删除工作区子目录（递归） */
export async function deleteWorkspaceSubdir(sub: WorkspaceSubDir, dirName: string): Promise<void> {
  return invoke("delete_workspace_subdir", { sub, dirName });
}

/** 将工作区文件移动到目标目录（空字符串表示根目录） */
export async function moveWorkspaceFile(sub: WorkspaceSubDir, fileId: string, targetDir: string): Promise<void> {
  return invoke("move_workspace_file", { sub, fileId, targetDir });
}
