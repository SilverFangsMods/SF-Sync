import { defineConfig } from "vite";

// Tauri espera porta fixa 1420 em dev.
export default defineConfig({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    target: "esnext",
  },
});
