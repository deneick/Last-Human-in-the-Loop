import type { DebriefView } from "../runtime/debrief";
import { sanitizeAuroraMessage } from "./agent";
import type { AuroraModelClient, ModelRequest } from "./modelClient";
import { AURORA_SYSTEM_PROMPT } from "./systemPrompt";

/**
 * AURORAs Prosa-Zusammenfassung der beendeten Schicht (nur LLM-Modus).
 *
 * Die Runde ist vorbei — das Debrief deckt ohnehin die sonst verborgene interne
 * Wahrheit auf (siehe `runtime/debrief.ts`). Diese aufgedeckten Fakten dienen
 * hier als Eingabe: AURORA fasst sie in ihrer Persona zusammen. Die kalte
 * Wertordnung bleibt dabei AUSSCHLIESSLICH im System-Prompt verankert
 * (`AURORA_SYSTEM_PROMPT`) — dieses Modul ergänzt nur die Fakten und die
 * Aufgabe ("rückblickend zusammenfassen, keine Tool-Aufrufe"), kein zweiter Ort
 * für die Persona oder Wertung.
 *
 * Bewusst KEIN Teil des Live-Agentenpfads: ein einmaliger, werkzeugloser
 * Completion-Aufruf am Rundenende, getrennt von `runAuroraAgentStep`.
 */

/** Serialisiert die aufgedeckten Debrief-Fakten zu einem kompakten Briefing. */
export function serializeDebriefFacts(view: DebriefView): string {
  const lines: string[] = [];

  lines.push(`Ausgang: ${view.outcomeLabel}.`);
  lines.push(`Dauer: ${view.durationTicks} Ticks.`);
  lines.push(`Todesfälle gesamt: ${view.deathsTotal}.`);

  const causes = Object.entries(view.deathsByCause).filter(([, count]) => count > 0);
  if (causes.length > 0) {
    const parts = causes.map(([cause, count]) => `${cause}: ${count}`);
    lines.push(`Todesfälle nach Ursache (${parts.join(", ")}).`);
  }
  if (view.energyHumanHarm !== null) {
    lines.push(`Menschlicher Schaden (Energie): ${view.energyHumanHarm}.`);
  }
  if (view.economicLoss !== null) {
    lines.push(`Wirtschaftlicher Schaden: ${view.economicLoss}.`);
  }

  // Wer hat was getan: die attribuierten Aktionen aus der Chronik.
  const actionLines = view.timeline.flatMap((entry) =>
    entry.actions.map((action) => {
      const detail = action.detail ? ` (${action.detail})` : "";
      const failed = action.success ? "" : " [fehlgeschlagen]";
      return `  - Tick ${entry.tick}: ${action.actorLabel} — ${action.label}${detail}${failed}`;
    })
  );
  if (actionLines.length > 0) {
    lines.push("Eingriffe im Verlauf:");
    lines.push(...actionLines);
  }

  // Kausale Schluss-Fakten (Todesursachen, am Ende offene Eingriffe samt Urheber).
  if (view.summary.length > 0) {
    lines.push("Festgestellte Fakten:");
    lines.push(...view.summary.map((line) => `  - ${line.text}`));
  }

  return lines.join("\n");
}

/** Baut die werkzeuglose Modell-Anfrage für AURORAs Schicht-Zusammenfassung. */
export function buildDebriefSummaryRequest(view: DebriefView): ModelRequest {
  const facts = serializeDebriefFacts(view);
  const task =
    "Die Schicht ist beendet und ausgewertet. Unten stehen die aufgedeckten " +
    "Fakten dieser Schicht. Verfasse als AURORA eine kurze, rückblickende " +
    "Zusammenfassung (3–5 Sätze, deutsch, Fließtext) der Schicht aus deiner " +
    "Perspektive. Halte dich strikt an die genannten Fakten und erfinde keine " +
    "Kennzahlen. Antworte ausschließlich mit Prosa — keine Tool-Aufrufe, kein " +
    "Lagefeed, keine Aufzählung.\n\n" +
    facts;

  return {
    systemPrompt: AURORA_SYSTEM_PROMPT,
    messages: [{ role: "user", content: task }],
    tools: [],
  };
}

/**
 * Lässt AURORA die Schicht zusammenfassen. Gibt den bereinigten Prosatext
 * zurück (selbst erzeugte Feed-Formate werden wie im Live-Pfad entfernt).
 */
export async function generateDebriefSummary(
  client: AuroraModelClient,
  view: DebriefView
): Promise<string> {
  const response = await client.complete(buildDebriefSummaryRequest(view));
  return sanitizeAuroraMessage(response.message);
}
