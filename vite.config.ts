import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1742,
    strictPort: false,
    host: host || false,
    hmr: host
      ? { protocol: "ws", host, port: 1743 }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
