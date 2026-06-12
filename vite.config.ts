import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  // ANTHROPIC_API_KEY aus .env.local oder der Shell-Umgebung — der Key wird
  // ausschließlich hier im Dev-Server verwendet und erreicht nie den Browser.
  const env = loadEnv(mode, process.cwd(), "");

  return {
    plugins: [react()],
    server: {
      proxy: {
        "/api/anthropic": {
          target: "https://api.anthropic.com",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/anthropic/, ""),
          headers: { "x-api-key": env.ANTHROPIC_API_KEY ?? "" },
        },
      },
    },
  };
});
