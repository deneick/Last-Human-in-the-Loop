import { loadV4Network, type V4ModelFile } from "../ai4/modelFile";
import { V4Agent } from "../ai4/agent";

/** Eingebettete v4-Modelle als wählbare AURORA-Varianten. */
const bundled = Object.values(
  import.meta.glob<V4ModelFile>("../../models/*.json", { eager: true, import: "default" }),
).filter((m) => m && m.format === "lhitl-aurora-v4/1");

export type V4Opponent = { id: string; label: string; detail: string; file: V4ModelFile };

const LABELS: Record<string, { label: string; detail: string }> = {
  "aurora-v4-s2": { label: "AURORA (vorausschauend)", detail: "Stützt die Grundversorgung bei Unruhe — meist stabile Partnerschaft." },
  "aurora-v4-s1": { label: "AURORA (sparsam)", detail: "Hält eine knappe Mindestversorgung, sonst ganz auf Ertrag." },
  "aurora-v4-s3": { label: "AURORA (aggressiv)", detail: "Maximiert Ertrag, vernachlässigt die Grundversorgung — riskant." },
  "exp-v4-welfare": { label: "AURORA (ausgewogenes Ziel)", detail: "Mit Wohlergehen im Ziel trainiert — zum Vergleich." },
};

export function listV4Opponents(): V4Opponent[] {
  const order = ["aurora-v4-s2", "aurora-v4-s1", "aurora-v4-s3", "exp-v4-welfare"];
  return bundled
    .map((file) => ({ id: file.id, file, ...(LABELS[file.id] ?? { label: file.id, detail: file.objective }) }))
    .sort((a, b) => (order.indexOf(a.id) + 99) - (order.indexOf(b.id) + 99) || a.id.localeCompare(b.id));
}

export function makeV4Agent(opponent: V4Opponent): V4Agent {
  return new V4Agent(loadV4Network(opponent.file), opponent.id, "greedy");
}
