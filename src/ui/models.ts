import { loadNetwork, type ModelFile } from "../ai/modelFile";
import { NeuralAgent } from "../ai/neuralAgent";
import { RandomAgent, ScriptedAgent } from "../ai/baselines";
import type { AuroraAgent } from "../ai/agent";

/**
 * Modellregister der UI: mitgelieferte Modelle (models/aurora-*.json, beim
 * Build eingebettet), im Browser nachtrainierte Modelle (localStorage) und
 * die Baselines zum Vergleich.
 */
const bundled = Object.values(
  import.meta.glob<ModelFile>("../../models/aurora-*.json", { eager: true, import: "default" }),
)
  // Nur v2/v3-Netze (Graph+GRU). v4-Modelle (Delegationsökonomie) haben ein
  // eigenes Format und werden von der v4-Oberfläche geladen.
  .filter((m) => m.format === "lhitl-aurora/1")
  .sort((a, b) => a.id.localeCompare(b.id));

const evaluation = Object.values(
  import.meta.glob<{ best: string | null }>("../../models/evaluation.json", { eager: true, import: "default" }),
)[0];

const LOCAL_KEY = "lhitl2.localModels";

export type Opponent = { id: string; label: string; detail: string; source: "bundled" | "local" | "baseline"; file?: ModelFile };

export function loadLocalModels(): ModelFile[] {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY) ?? "[]") as ModelFile[];
  } catch {
    return [];
  }
}

export function saveLocalModel(file: ModelFile): void {
  try {
    const all = loadLocalModels().filter((m) => m.id !== file.id);
    localStorage.setItem(LOCAL_KEY, JSON.stringify([...all, file].slice(-10)));
  } catch {
    /* Storage nicht verfügbar */
  }
}

export function listOpponents(): Opponent[] {
  const fromFile = (file: ModelFile, source: "bundled" | "local"): Opponent => ({
    id: file.id,
    label: file.id,
    detail: `${file.algorithm.toUpperCase()} · ${file.episodes.toLocaleString("de-DE")} Trainingspartien${file.parent ? ` · aus ${file.parent}` : ""}`,
    source,
    file,
  });
  return [
    ...bundled.map((f) => fromFile(f, "bundled")),
    ...loadLocalModels().map((f) => fromFile(f, "local")),
    { id: "baseline:regelbasiert", label: "Regelbasiert", detail: "Handgeschriebene Strategie (Baseline)", source: "baseline" },
    { id: "baseline:zufall", label: "Zufall", detail: "Zufällige gültige Aktionen (Baseline)", source: "baseline" },
  ];
}

export function defaultOpponentId(): string {
  const best = evaluation?.best;
  if (best && bundled.some((m) => m.id === best)) return best;
  return bundled.at(-1)?.id ?? "baseline:regelbasiert";
}

export function createAgent(opponent: Opponent): AuroraAgent {
  if (opponent.file) return new NeuralAgent(loadNetwork(opponent.file), opponent.id);
  return opponent.id === "baseline:zufall" ? new RandomAgent() : new ScriptedAgent();
}
