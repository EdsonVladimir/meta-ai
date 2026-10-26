import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Puerto fijo 1420: es el `devUrl` declarado en src-tauri/tauri.conf.json.
// Sin variables VITE_* a propósito: la clave de Meta solo existe en el
// proceso nativo de Rust y jamás llega al frontend.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    target: "es2021",
  },
});
