import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1430, strictPort: true, fs: { allow: ["../.."] } },
  build: { target: "safari15", chunkSizeWarningLimit: 1200 },
});
