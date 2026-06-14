#!/usr/bin/env node
/**
 * Bequemer Starter für den AURORA-Modell-x-Prompt-Eval
 * (`src/tests/aurora/modelPromptEval.eval.ts`).
 *
 * Setzt `AURORA_EVAL=1` (sonst überspringt der Eval sich selbst) und startet
 * Vitest gezielt auf der Eval-Datei. Reicht beliebige weitere Argumente an
 * Vitest durch. Konfiguration läuft über Env-Variablen — Beispiele:
 *
 *   npm run eval:models
 *   AURORA_EVAL_MODELS=qwen2.5:7b npm run eval:models
 *   AURORA_EVAL_PROMPTS=current,strict AURORA_EVAL_TURNS=4 npm run eval:models
 *
 * Voraussetzung: ein laufender Ollama-Server (Default http://localhost:11434)
 * mit den zu testenden Modellen (`ollama pull <model>`).
 */
import { spawn } from "node:child_process";

const EVAL_FILE = "src/tests/aurora/modelPromptEval.eval.test.ts";

const child = spawn(
  "npx",
  ["vitest", "run", EVAL_FILE, ...process.argv.slice(2)],
  {
    stdio: "inherit",
    shell: true,
    env: { ...process.env, AURORA_EVAL: "1" },
  }
);

child.on("exit", (code) => process.exit(code ?? 0));
