/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base "./": relative Pfade, damit der Build auch unter einem Unterpfad
// (z. B. GitHub Pages /Last-Human-in-the-Loop/) funktioniert.
export default defineConfig({
  base: "./",
  plugins: [react()],
  worker: { format: "es" },
  test: {
    environment: "jsdom",
    testTimeout: 30000,
  },
});
