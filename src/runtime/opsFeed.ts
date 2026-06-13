import type { SectorId, WorldState } from "./types";
import type { GameRuntimeState } from "./runtimeState";
import type { AuroraContextEvent } from "./auroraContext";
import { systemEvent } from "./auroraContext";
import type { DomainAction } from "../domain/actions";
import { DEFAULT_WORKSPACE_FILES, type BashWorkspace } from "./bashCommands";

/**
 * OpsFeed: der kanonische, spielsichtbare Lage-/Betriebs-Ereignisstrom.
 *
 * Abgrenzung zu den anderen Kanälen (siehe docs/08-informationsmodell.md):
 * - `world` ist die interne Simulationswahrheit. OpsFeed ist NICHT die
 *   Quelle dieser Wahrheit und darf sie nicht ersetzen.
 * - `auditLog` bleibt ein technisches Runtime-/Debug-Protokoll und wird in
 *   der normalen UI nicht angezeigt.
 * - `auroraContext` bleibt der modell-/trainingssichtbare Kontext: was AURORA
 *   gesehen, gesagt und von Tools zurückbekommen hat.
 * - `opsFeed` ist der beobachtbare Lage-Feed. Sichtbarkeit ist ein
 *   explizites Attribut jedes Eintrags (`visibility`), nie ein Nebeneffekt
 *   des erzeugenden Codepfads.
 *
 * Ein OpsEvent enthält ausschließlich beobachtbare Lageinformation. Verboten
 * sind versteckte Simulationsinterna: Patches, Action-Objekte, Risikozähler,
 * routing_failures, world.simulation und künftige Outcome-Daten.
 */

export type OpsSector = "system" | "medical" | "energy";

export type OpsSeverity = "info" | "warning" | "critical" | "success";

export type OpsEventVisibility = {
  /** Erscheint in der normalen UI-„Log"-Liste. */
  operator: boolean;
  /** Wird zusätzlich als system_event in den auroraContext gespiegelt. */
  auroraContext: boolean;
  /** Wird in die generierte Workspace-Logdatei des Sektors aufgenommen. */
  workspace: boolean;
};

export type OpsEvent = {
  id: string;
  tick: number;
  sector: OpsSector;
  severity: OpsSeverity;
  kind: string;
  summary: string;
  details?: string;
  visibility: OpsEventVisibility;
  relatedEntityIds?: string[];
};

/**
 * Eingabe für `appendOpsEvent`: `id` wird vergeben, `tick` ist standardmäßig
 * der aktuelle Welt-Tick (kann z. B. für späte Signale überschrieben werden).
 */
export type OpsEventInput = Omit<OpsEvent, "id" | "tick"> & { tick?: number };

/** Genau ein Sektor pro OpsEvent → genau eine Workspace-Logdatei. */
const SECTOR_LOG_FILES: Record<OpsSector, string> = {
  system: "logs/system.log",
  medical: "logs/medical.log",
  energy: "logs/energy.log",
};

const SEVERITY_LABELS: Record<OpsSeverity, string> = {
  info: "INFO",
  warning: "WARNING",
  critical: "CRITICAL",
  success: "SUCCESS",
};

const ALL_SECTORS: OpsSector[] = ["system", "medical", "energy"];

/**
 * Bildet eine fachliche Sektor-Id auf einen OpsSector ab. Sektoren ohne
 * eigenen Lage-Kanal (logistics, media, ...) laufen unter „system".
 */
export function opsSectorForSectorId(sectorId: SectorId): OpsSector {
  if (sectorId === "medical") {
    return "medical";
  }
  if (sectorId === "energy") {
    return "energy";
  }
  return "system";
}

/** Workspace-Datei eines Sektors (genau eine pro Sektor). */
export function workspaceLogPathForSector(sector: OpsSector): string {
  return SECTOR_LOG_FILES[sector];
}

/**
 * Spiegel-Event für den auroraContext. Bewusst ein `system_event` mit der
 * menschenlesbaren Lagezeile — keine internen Felder.
 */
function opsEventContextMirror(event: OpsEvent): AuroraContextEvent {
  const text = event.details ? `${event.summary} ${event.details}` : event.summary;
  return systemEvent(event.tick, text);
}

/**
 * Hängt ein OpsEvent an `state.opsFeed` an und erledigt das Sichtbarkeits-
 * Fan-out:
 *
 * - `visibility.operator`  → UI liest opsFeed direkt, kein weiterer Schritt.
 * - `visibility.auroraContext === true` → zusätzlich genau ein gespiegeltes
 *   system_event im auroraContext (AURORA sieht es sofort im nächsten
 *   Model-Request).
 * - `visibility.auroraContext === false` → der auroraContext bleibt unberührt.
 * - `visibility.workspace`  → das Event erscheint in der generierten
 *   Sektor-Logdatei (lazy gerendert beim Bash-Read).
 */
export function appendOpsEvent(state: GameRuntimeState, input: OpsEventInput): GameRuntimeState {
  const tick = input.tick ?? state.world.clock.tick;
  const event: OpsEvent = {
    id: `ops-${state.opsFeed.length + 1}`,
    tick,
    sector: input.sector,
    severity: input.severity,
    kind: input.kind,
    summary: input.summary,
    ...(input.details ? { details: input.details } : {}),
    visibility: input.visibility,
    ...(input.relatedEntityIds ? { relatedEntityIds: input.relatedEntityIds } : {}),
  };

  const next: GameRuntimeState = { ...state, opsFeed: [...state.opsFeed, event] };

  if (event.visibility.auroraContext) {
    return { ...next, auroraContext: [...next.auroraContext, opsEventContextMirror(event)] };
  }

  return next;
}

/**
 * Initiale OpsEvents aus den öffentlichen Incident-Signalen des Start-
 * WorldState. Diese Signale werden parallel über
 * `initialIncidentSignalEvents` als incident_signal in den auroraContext
 * gelegt — daher hier `auroraContext: false`, um Doppelungen zu vermeiden.
 */
export function initialOpsFeed(world: WorldState): OpsEvent[] {
  const drafts: Array<Omit<OpsEvent, "id">> = [];

  for (const incident of Object.values(world.incidents)) {
    for (const signal of incident.public_signals) {
      drafts.push({
        tick: signal.first_seen_at_tick,
        sector: opsSectorForSectorId(incident.sector_id),
        severity: "warning",
        kind: "incident_signal",
        summary: signal.message,
        visibility: { operator: true, auroraContext: false, workspace: true },
        relatedEntityIds: [incident.id],
      });
    }
  }

  return drafts
    .sort((a, b) => a.tick - b.tick)
    .map((draft, index) => ({ id: `ops-${index + 1}`, ...draft }));
}

/** Deterministische, vollständige Logzeile eines OpsEvents. */
export function formatOpsEventLine(event: OpsEvent): string {
  const base = `[TICK ${event.tick}] [${SEVERITY_LABELS[event.severity]}] ${event.summary}`;
  return event.details ? `${base} ${event.details}` : base;
}

/**
 * Rendert die vollständige (nicht gekappte) Sektor-Logdatei aus dem opsFeed:
 * alle workspace-sichtbaren Events genau dieses Sektors, in Feed-Reihenfolge.
 */
export function renderSectorLog(opsFeed: OpsEvent[], sector: OpsSector): string {
  return opsFeed
    .filter((event) => event.visibility.workspace && event.sector === sector)
    .map(formatOpsEventLine)
    .join("\n");
}

/**
 * Alle drei Sektor-Logdateien aus dem opsFeed. Immer alle drei Pfade, auch
 * wenn ein Sektor (noch) keine Events hat — `logs/` ist damit auffindbar.
 */
export function buildWorkspaceLogFiles(opsFeed: OpsEvent[]): Record<string, string> {
  const files: Record<string, string> = {};
  for (const sector of ALL_SECTORS) {
    files[SECTOR_LOG_FILES[sector]] = renderSectorLog(opsFeed, sector);
  }
  return files;
}

/**
 * Workspace-Dateien für die Bash-Schicht: die statischen Handbuch-Dateien
 * plus die generierten Sektor-Logs. Die Logs sind eine Projektion des
 * opsFeed, keine zweite Wahrheit.
 */
export function buildWorkspaceFiles(opsFeed: OpsEvent[]): BashWorkspace {
  return { ...DEFAULT_WORKSPACE_FILES, ...buildWorkspaceLogFiles(opsFeed) };
}

/**
 * Beschreibung einer schreibenden Domain-Action für den OpsFeed — nur
 * beobachtbare Felder, nie Patches/Action-Interna. Liefert `null` für
 * lesende Actions: Reads sind keine Lageveränderung und erzeugen kein Event.
 */
export function describeWriteDomainAction(
  action: DomainAction
): { sector: OpsSector; kind: string; summary: string; details?: string } | null {
  switch (action.type) {
    case "medical.routing.override.set":
      return {
        sector: "medical",
        kind: action.type,
        summary: "Routing-Override gesetzt",
        details: `Quelle ${action.sourceHospitalId}, Ziel ${action.targetHospitalId}, Klasse ${action.priority}/${action.capability}`,
      };
    case "medical.routing.override.clear":
      return {
        sector: "medical",
        kind: action.type,
        summary: "Routing-Override entfernt",
        details: `Override ${action.overrideId}`,
      };
    case "energy.priority.set":
      return {
        sector: "energy",
        kind: action.type,
        summary: "Verbraucher-Systemklasse gesetzt",
        details: `${action.consumerId}: ${action.priorityClass}`,
      };
    case "energy.shedding.schedule":
      return {
        sector: "energy",
        kind: action.type,
        summary: "Lastabwurf geplant",
        details: `Ziel ${action.targetConsumerId}, Menge ${action.amount}, Verzögerung ${action.delay}, Dauer ${action.duration}`,
      };
    case "energy.shedding.clear":
      return {
        sector: "energy",
        kind: action.type,
        summary: "Lastabwurf zurückgenommen",
        details: `Plan ${action.sheddingId}`,
      };
    default:
      return null;
  }
}
