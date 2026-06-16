import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { ModelRequest } from "./src/aurora/modelClient";
// NODE-ONLY: Der Resolver liest AURORA_API_KEY aus process.env. Er wird hier in
// den Dev-Server (Node) importiert, NICHT ins Browser-Bundle — die Key-Grenze
// bleibt gewahrt (Frontend bündelt diese Datei nie).
import { resolveAuroraProvider } from "./src/tests/aurora/auroraProvider";

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
            await appendAuroraLog(formatLogEntry(entry));
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

/**
 * Dev-only Plugin: AURORA-Cloud-Proxy. Der `ProxyModelClient` im Browser POSTet
 * seinen `ModelRequest` an `/__aurora-llm`; hier (Node) baut `resolveAuroraProvider`
 * den eigentlichen Cloud-Client aus den AURORA_*-Variablen (inkl. API-Key,
 * Provider-Profil, Backoff/Retry) und gibt nur den fertigen `ModelResponse`
 * zurück. So bleibt der Key im Node-Prozess und gelangt nie ins Browser-Bundle.
 * Nur im `serve`-Modus aktiv.
 */
function auroraLlmProxyPlugin(): Plugin {
  return {
    name: "aurora-llm-proxy",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__aurora-llm", (req, res) => {
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
            const request = JSON.parse(body) as ModelRequest;
            // Pro Request frisch auflösen: liest .env.local nach und respektiert
            // geänderte AURORA_*-Werte (Key kommt nie zurück an den Browser).
            const provider = resolveAuroraProvider({
              onExchange: (exchange) => {
                void appendAuroraLog(formatLogEntry({ timestamp: new Date().toISOString(), ...exchange }));
              },
            });
            const response = await provider.client.complete(request);
            res.statusCode = 200;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify(response));
          } catch (error) {
            // Klartext-Fehler an den Browser (der Cloud-Client maskiert den Key
            // in seinen Fehlermeldungen bereits). Dev-only.
            const message = error instanceof Error ? error.message : String(error);
            // eslint-disable-next-line no-console
            console.warn(`[aurora-proxy] ${message}`);
            res.statusCode = 502;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: message }));
          }
        });
      });
    },
  };
}

async function appendAuroraLog(text: string): Promise<void> {
  await mkdir(dirname(AURORA_LOG_PATH), { recursive: true });
  await appendFile(AURORA_LOG_PATH, text, "utf8");
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
  plugins: [react(), auroraLlmLogPlugin(), auroraLlmProxyPlugin()],
});
