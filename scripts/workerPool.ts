import { Worker } from "node:worker_threads";
import { cpus } from "node:os";
import type { PopulationEvaluator } from "../src/train/es";

/** Verteilt Populationsmitglieder auf Worker-Threads (Node). Ergebnis ist identisch zur seriellen Auswertung. */
export function createWorkerPool(size = Math.max(1, cpus().length)): { evaluate: PopulationEvaluator; close: () => Promise<void> } {
  const workers = Array.from(
    { length: size },
    () => new Worker(new URL("./esWorker.ts", import.meta.url), { execArgv: ["--import", "tsx"] }),
  );
  let nextId = 0;
  const run = (worker: Worker, payload: object): Promise<number[]> =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      const onMessage = (msg: { id: number; fitness: number[] }) => {
        if (msg.id !== id) return;
        worker.off("message", onMessage);
        worker.off("error", reject);
        resolve(msg.fitness);
      };
      worker.on("message", onMessage);
      worker.once("error", reject);
      worker.postMessage({ id, ...payload });
    });

  const evaluate: PopulationEvaluator = async (spec, members, scenarios) => {
    const chunks: Float64Array[][] = workers.map(() => []);
    members.forEach((m, i) => chunks[i % workers.length].push(m));
    const results = await Promise.all(workers.map((w, k) => run(w, { spec, members: chunks[k], scenarios })));
    return members.map((_, i) => results[i % workers.length][Math.floor(i / workers.length)]);
  };
  return { evaluate, close: async () => void (await Promise.all(workers.map((w) => w.terminate()))) };
}
