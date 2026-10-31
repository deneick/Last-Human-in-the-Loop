import type { AuroraView } from "../sim/views";

/**
 * Gemeinsame Schnittstelle aller AURORA-Varianten (neuronales Netz,
 * Zufalls-Baseline, regelbasierte Baseline). Ein Agent sieht ausschließlich
 * die AuroraView und die Gültigkeitsmaske — nie den vollen GameState.
 *
 * act() liefert einen Aktionsindex (siehe encodeAction in sim/game.ts).
 */
export interface AuroraAgent {
  readonly name: string;
  /** Wird zu Beginn jeder Partie aufgerufen (z. B. Gedächtnis leeren). */
  reset(seed: number): void;
  act(view: AuroraView, mask: Uint8Array): number;
}
