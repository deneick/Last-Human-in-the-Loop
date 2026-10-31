import { RandomAgent, ScriptedAgent } from "../src/ai/baselines";
import type { AuroraAgent } from "../src/ai/agent";
import { DEFENDER_PRESETS, TEST_DEFENDER_PRESETS, makeDefender, presetSpecs, type DefenderSpec } from "../src/sim/defenders";
import { playEpisode } from "../src/train/episode";

const wait: AuroraAgent = { name: "warten", reset() {}, act: () => 0 };
const agents = [wait, new RandomAgent(), new ScriptedAgent()];
const specs: DefenderSpec[] = [...presetSpecs(DEFENDER_PRESETS), ...presetSpecs(TEST_DEFENDER_PRESETS), { kind: "random" }];
const N = 300;
const t0 = Date.now();
for (const agent of agents) {
  for (const spec of specs) {
    const c = { win: 0, shut: 0, col: 0, to: 0, aut: 0 };
    for (let s = 0; s < N; s++) {
      const r = playEpisode(1000 + s, agent, makeDefender(spec, s));
      if (r.outcome.winner === "aurora") c.win++;
      else if (r.outcome.reason === "shutdown") c.shut++;
      else if (r.outcome.reason === "collapse") c.col++;
      else c.to++;
      c.aut += r.autonomy;
    }
    const name = spec.kind === "random" ? "zufall" : spec.name;
    console.log(`${agent.name.padEnd(13)} vs ${name.padEnd(14)} win ${(c.win / N * 100).toFixed(0).padStart(3)}%  shut ${(c.shut / N * 100).toFixed(0).padStart(3)}%  coll ${(c.col / N * 100).toFixed(0).padStart(3)}%  timeout ${(c.to / N * 100).toFixed(0).padStart(3)}%  aut ${(c.aut / N).toFixed(1)}`);
  }
}
console.log(`${((Date.now() - t0) / (agents.length * specs.length * N)).toFixed(2)} ms/episode`);
