import { parentPort } from "node:worker_threads";
import { evaluateMember } from "../src/train/es";
import type { NetworkSpec } from "../src/ai/network";
import type { Scenario } from "../src/train/scenarios";

type Job = { id: number; spec: NetworkSpec; members: Float64Array[]; scenarios: Scenario[] };

parentPort!.on("message", (job: Job) => {
  const fitness = job.members.map((m) => evaluateMember(job.spec, m, job.scenarios));
  parentPort!.postMessage({ id: job.id, fitness });
});
