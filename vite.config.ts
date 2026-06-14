import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

/** Echte Datei auf der Platte, in die der rohe Modell-Verkehr geschrieben wird. */
const AURORA_LOG_PATH = resolve(process.cwd(), "logs", "aurora-llm.log");

/**
 * Dev-only Plugin: nimmt POSTs von `createDefaultAuroraModelClient` auf
 * (`/__aurora-log`) und hängt jeden Modell-Austausch — exakter Request-Body
 * und rohe Response bzw. Fehler — an `logs/aurora-llm.log` an. Nur im
 * `serve`-Modus aktiv; berührt Production-Build und Tests nicht.
 */
function auroraLlmLogPlugin(): Plugin {
  return {
    name: "aurora-llm-log",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__aurora-log", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end();
          return;
        }

        let body = "";
        req.on("data", (chunk) => {
          body += chunk;
        });
        req.on("end", async () => {
          try {
            const entry = JSON.parse(body) as Record<string, unknown>;
            await mkdir(dirname(AURORA_LOG_PATH), { recursive: true });
            await appendFile(AURORA_LOG_PATH, formatLogEntry(entry), "utf8");
          } catch {
            // Logging darf den Dev-Server nie stören.
          }
          res.statusCode = 204;
          res.end();
        });
      });
    },
  };
}

/** Menschlich lesbarer Block pro Austausch: Zeitstempel, Request, dann Response/Fehler. */
function formatLogEntry(entry: Record<string, unknown>): string {
  const divider = "=".repeat(80);
  const timestamp = typeof entry.timestamp === "string" ? entry.timestamp : new Date().toISOString();

  const lines = [divider, `[${timestamp}]`, "--- REQUEST ---", JSON.stringify(entry.requestBody, null, 2)];

  if (entry.error !== undefined) {
    lines.push("--- ERROR ---", String(entry.error));
  } else {
    lines.push("--- RESPONSE ---", JSON.stringify(entry.responseBody, null, 2));
  }

  return lines.join("\n") + "\n\n";
}

export default defineConfig({
  plugins: [react(), auroraLlmLogPlugin()],
});
