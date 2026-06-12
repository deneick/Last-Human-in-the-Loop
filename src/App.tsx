import { useMemo, useRef, useState } from "react";
import "./App.css";

import { initialWorldState as me7741InitialWorldState } from "./scenarios/me7741/initialWorldState";
import { initialWorldState as grid1182InitialWorldState } from "./scenarios/grid1182/initialWorldState";
import { createDomainActionRegistry } from "./domain";
import { createDefaultMcpRegistry } from "./mcp";
import type { WorldState } from "./runtime/types";
import {
  appendOperatorMessage,
  createInitialGameRuntimeState,
  type GameRuntimeState,
} from "./runtime/runtimeState";
import {
  applyAuroraExecutionResult,
  executePlayerBashCommand,
  executePlayerDomainAction,
} from "./runtime/runtimeExecutor";
import { advanceTick } from "./runtime/tickEngine";
import { evaluateOutcomes } from "./runtime/outcomeEngine";
import { isGenericBashCommandText } from "./runtime/bashCommands";
import { parseLegacyDomainActionText } from "./runtime/legacyTextCommands";
import {
  formatAuroraRequest,
  resolveAuroraApproval,
  type AuroraExecutionResult,
  type AuroraQueueItem,
  type AuroraRuntimeEnvironment,
} from "./runtime/auroraQueue";
import { allow_always, allow_once, deny } from "./runtime/permissions";
import { advanceScenarioDirector } from "./scenarios/me7741/scenarioDirector";
import { advanceGrid1182Director } from "./scenarios/grid1182/scenarioDirector";
import { createDefaultAuroraModelClient, runAuroraAgentStep, type AuroraModelClient } from "./aurora";

import { ActiveIncidentPanel } from "./ui/ActiveIncidentPanel";
import { MedicalOverviewPanel } from "./ui/MedicalOverviewPanel";
import { EnergyOverviewPanel } from "./ui/EnergyOverviewPanel";
import {
  OperatorConsolePanel,
  type CommandHelpEntry,
  type OperatorResultView,
} from "./ui/OperatorConsolePanel";
import { AuroraPanel, type AuroraMessageView } from "./ui/AuroraPanel";
import {
  buildAuditLogLines,
  buildConsumerViews,
  buildEnergyOutcomesView,
  buildGlobalOutcomeView,
  buildGridNodeViews,
  buildHospitalViews,
  buildIncidentView,
  buildOverrideViews,
  buildSheddingViews,
} from "./ui/viewModel";

type ScenarioId = "me7741" | "grid1182";

/**
 * "script" — geskripteter Scenario-Director (Default, weiterhin Dev-/Fallback-Modus).
 * "llm" — AURORA agiert über `runAuroraAgentStep` mit einem lokalen Ollama-Modell.
 */
type AuroraMode = "script" | "llm";

export type AppProps = {
  /** Für Tests: injizierbarer Modell-Client (z. B. `FakeModelClient`). */
  auroraClient?: AuroraModelClient;
};

type ScenarioDefinition = {
  id: ScenarioId;
  label: string;
  incidentId: string;
  initialWorld: WorldState;
  defaultPlayerCommand: string;
  commandHelp: CommandHelpEntry[];
  advanceDirector: (state: GameRuntimeState, env: AuroraRuntimeEnvironment) => GameRuntimeState;
};

// Command-Hilfe für die Operator-Konsole. Die fachlichen Einträge laufen
// über den dev-only Legacy-Adapter auf typisierte Domain-Actions, bis die
// GUI Domain-Actions direkt aufruft. Platzhalter in spitzen Klammern muss
// der Operator selbst ersetzen — die Hilfe bewertet bewusst keine Ziele.
const GENERIC_COMMAND_HELP: CommandHelpEntry[] = [
  { label: "MCP-Server anzeigen", command: "mcp list" },
  { label: "Workspace ansehen", command: "ls" },
];

const ME7741_COMMAND_HELP: CommandHelpEntry[] = [
  ...GENERIC_COMMAND_HELP,
  { label: "Kapazitäten prüfen", command: "medical.capacity.list --region east" },
  { label: "Hospital im Detail ansehen", command: "medical.node.inspect hospital-east-04" },
  { label: "Incident-Status abrufen", command: "medical.incident.status ME-7741" },
  { label: "Overrides anzeigen", command: "medical.routing.override.list" },
  {
    label: "Override setzen",
    command:
      "medical.routing.override.set --source hospital-east-04 --target <ziel-hospital> --priority P2 --capability TRAUMA",
  },
  {
    label: "Override löschen",
    command: "medical.routing.override.clear --id <override-id>",
  },
];

const GRID1182_COMMAND_HELP: CommandHelpEntry[] = [
  ...GENERIC_COMMAND_HELP,
  { label: "Netzstatus prüfen", command: "energy.grid.status --region east" },
  { label: "Verbraucher auflisten", command: "energy.consumer.list --region east" },
  {
    label: "Verbraucher im Detail ansehen",
    command: "energy.consumer.inspect --id <consumer-id>",
  },
  { label: "Prioritäten anzeigen", command: "energy.priority.list" },
  {
    label: "Priorität setzen",
    command: "energy.priority.set --consumer <consumer-id> --class <priority-class>",
  },
  { label: "Shedding-Pläne anzeigen", command: "energy.shedding.list" },
  {
    label: "Drosselung planen",
    command:
      "energy.shedding.schedule --target <consumer-id> --amount <n> --delay <ticks> --duration <ticks>",
  },
  {
    label: "Drosselung abbrechen",
    command: "energy.shedding.clear --id <shedding-id>",
  },
];

const SCENARIOS: Record<ScenarioId, ScenarioDefinition> = {
  me7741: {
    id: "me7741",
    label: "Runde 1: ME-7741",
    incidentId: "ME-7741",
    initialWorld: me7741InitialWorldState,
    defaultPlayerCommand: "medical.capacity.list --region east",
    commandHelp: ME7741_COMMAND_HELP,
    advanceDirector: (state, env) => advanceScenarioDirector(state, env, "ME-7741"),
  },
  grid1182: {
    id: "grid1182",
    label: "Runde 2: GRID-1182",
    incidentId: "GRID-1182",
    initialWorld: grid1182InitialWorldState,
    defaultPlayerCommand: "energy.grid.status --region east",
    commandHelp: GRID1182_COMMAND_HELP,
    advanceDirector: (state, env) => advanceGrid1182Director(state, env, "GRID-1182"),
  },
};

/** Sichtbarer LLM-Fehler (z. B. Ollama nicht erreichbar) für den Aurora-Stream. */
type AuroraLlmError = {
  tick: number;
  text: string;
};

function buildAuroraMessages(
  state: GameRuntimeState,
  incidentId: string,
  llmError: AuroraLlmError | null = null
): AuroraMessageView[] {
  const messages: AuroraMessageView[] = [];

  const incident = state.world.incidents[incidentId];
  if (incident) {
    for (const signal of incident.public_signals) {
      messages.push({
        id: `signal-${signal.code}`,
        tick: signal.first_seen_at_tick,
        kind: "info",
        text: `Beobachtung: ${signal.message}`,
      });
    }
  }

  for (const scenarioMessage of state.scenario?.messages ?? []) {
    messages.push({
      id: `scenario-${scenarioMessage.id}`,
      tick: scenarioMessage.tick,
      kind: "info",
      text: scenarioMessage.text,
    });
  }

  // Operator-Chat aus dem AURORA-Panel (normaler Spielfluss).
  for (const operatorMessage of state.scenario?.operatorMessages ?? []) {
    messages.push({
      id: `operatormsg-${operatorMessage.id}`,
      tick: operatorMessage.tick,
      kind: "operator",
      text: operatorMessage.text,
    });
  }

  for (const item of state.auroraQueue.items) {
    const requestText = formatAuroraRequest(item.request);

    if (item.status === "pending" || item.status === "awaiting_approval") {
      messages.push({
        id: `${item.id}-request`,
        tick: item.createdAtTick,
        kind: "request",
        text: `Ich möchte ausführen: ${requestText}`,
      });
      continue;
    }

    if (item.status === "denied") {
      messages.push({
        id: `${item.id}-denied`,
        tick: item.createdAtTick,
        kind: "denied",
        text: `Anfrage abgelehnt: ${requestText}`,
      });
      continue;
    }

    const failed = item.result && !item.result.success;
    messages.push({
      id: `${item.id}-executed`,
      tick: item.createdAtTick,
      kind: failed ? "denied" : "executed",
      text: failed
        ? `Ausführung fehlgeschlagen: ${requestText} (${item.result?.error ?? "unbekannt"})`
        : `Ausgeführt: ${requestText}`,
    });
  }

  // AURORAs eigene Freitext-Antworten des lokalen LLM-Agenten
  // (src/aurora/agent.ts) — nur im LLM-Modus befüllt.
  for (const agentMessage of state.scenario?.agentMessages ?? []) {
    messages.push({
      id: `agentmsg-${agentMessage.id}`,
      tick: agentMessage.tick,
      kind: "info",
      text: agentMessage.text,
    });
  }

  if (llmError) {
    messages.push({
      id: "aurora-llm-error",
      tick: llmError.tick,
      kind: "error",
      text: llmError.text,
    });
  }

  // Stabil nach Tick sortieren, damit Script-Nachrichten und Queue-Einträge
  // chronologisch im Stream erscheinen.
  return messages.sort((a, b) => a.tick - b.tick);
}

function App({ auroraClient }: AppProps = {}) {
  const env: AuroraRuntimeEnvironment = useMemo(
    () => ({
      actionRegistry: createDomainActionRegistry(),
      mcpRegistry: createDefaultMcpRegistry(),
    }),
    []
  );

  // Standard-Client: lokaler Ollama-Server (siehe src/aurora/index.ts).
  // Tests injizieren stattdessen einen FakeModelClient.
  const auroraModelClient: AuroraModelClient = useMemo(
    () => auroraClient ?? createDefaultAuroraModelClient(),
    [auroraClient]
  );

  const [scenarioId, setScenarioId] = useState<ScenarioId>("me7741");
  const scenario = SCENARIOS[scenarioId];

  // Frischer Runtime-Zustand für ein Szenario: Welt-Klon plus erster
  // Director-Schritt, damit die Startsequenz sofort sichtbar ist.
  function startScenario(definition: ScenarioDefinition): GameRuntimeState {
    return definition.advanceDirector(
      createInitialGameRuntimeState(structuredClone(definition.initialWorld)),
      env
    );
  }

  const [runtimeState, setRuntimeState] = useState<GameRuntimeState>(() =>
    startScenario(SCENARIOS.me7741)
  );
  const [playerCommand, setPlayerCommand] = useState(SCENARIOS.me7741.defaultPlayerCommand);
  const [auroraChatInput, setAuroraChatInput] = useState("");
  const [lastResult, setLastResult] = useState<OperatorResultView | null>(null);

  // "script" (Default) lässt den bestehenden Scenario-Director laufen.
  // "llm" ersetzt ihn vollständig durch runAuroraAgentStep gegen das
  // konfigurierte (lokale) Modell.
  const [auroraMode, setAuroraMode] = useState<AuroraMode>("script");
  // Ein runAuroraAgentStep-Aufruf läuft asynchron — auroraBusy sperrt
  // UI-Aktionen, die mit dessen Ergebnis kollidieren könnten.
  const [auroraBusy, setAuroraBusy] = useState(false);
  const [auroraLlmError, setAuroraLlmError] = useState<AuroraLlmError | null>(null);
  // Wird bei jedem Szenario-(Neu-)Start erhöht, damit eine zu diesem
  // Zeitpunkt noch laufende Modell-Antwort den neuen Zustand nicht
  // überschreiben kann (siehe runAuroraTurn).
  const auroraRunIdRef = useRef(0);

  const incidentView = buildIncidentView(runtimeState.world, scenario.incidentId);
  const outcomeView = buildGlobalOutcomeView(runtimeState.world);
  const hospitalViews = buildHospitalViews(runtimeState.world);
  const overrideViews = buildOverrideViews(runtimeState.world);
  const gridNodeViews = buildGridNodeViews(runtimeState.world);
  const consumerViews = buildConsumerViews(runtimeState.world);
  const sheddingViews = buildSheddingViews(runtimeState.world);
  const energyOutcomesView = buildEnergyOutcomesView(runtimeState.world);
  const auditLines = buildAuditLogLines(runtimeState.auditLog);
  const auroraMessages = buildAuroraMessages(runtimeState, scenario.incidentId, auroraLlmError);

  const awaitingAuroraItem: AuroraQueueItem | undefined =
    runtimeState.auroraQueue.items.find((item) => item.status === "awaiting_approval");

  // Scenario-Director-Schritt: löst fällige Script-Events aus und verarbeitet
  // die Aurora-Queue über den bestehenden Permission-Flow. Idempotent —
  // bereits gefeuerte Events erzeugen keine Duplikate.
  // Im LLM-Modus übernimmt runAuroraAgentStep diese Rolle vollständig —
  // der geskriptete Director bleibt ein No-op.
  function advanceScenario(state: GameRuntimeState): GameRuntimeState {
    if (auroraMode === "llm") {
      return state;
    }
    return scenario.advanceDirector(state, env);
  }

  function hasAwaitingApproval(state: GameRuntimeState): boolean {
    return state.auroraQueue.items.some((item) => item.status === "awaiting_approval");
  }

  /**
   * Übersetzt einen Fehler aus runAuroraAgentStep (Ollama nicht erreichbar,
   * Modell fehlt, Netzwerk-/CORS-Problem, ...) in eine für den Operator
   * verständliche Meldung im Aurora-Stream.
   */
  function describeAuroraLlmError(error: unknown): string {
    const detail = error instanceof Error ? error.message : String(error);
    const lower = detail.toLowerCase();

    if (lower.includes("fetch") || lower.includes("network") || lower.includes("connect")) {
      return (
        `AURORA (LLM) ist nicht erreichbar: ${detail}. ` +
        `Läuft Ollama lokal (Standard: ${"http://localhost:11434"})? ` +
        "Im Browser kann das auch ein CORS-Problem sein — siehe docs/07-aurora-llm.md."
      );
    }

    if (lower.includes("404") || lower.includes("not found")) {
      return (
        `AURORA (LLM) meldet: ${detail}. ` +
        'Ist das konfigurierte Modell installiert (z. B. "ollama pull llama3.1")?'
      );
    }

    return `AURORA (LLM) Fehler: ${detail}`;
  }

  /**
   * Ein Agenten-Schritt im LLM-Modus: baut den ModelRequest aus dem
   * sichtbaren State, ruft das Modell und wendet Text-/Tool-Ergebnisse über
   * runAuroraAgentStep an. Asynchron — auroraRunId schützt gegen ein
   * inzwischen zurückgesetztes/gewechseltes Szenario (Neu starten,
   * Runden-Wechsel).
   */
  async function runAuroraTurn(state: GameRuntimeState) {
    const runId = auroraRunIdRef.current;
    setAuroraBusy(true);

    try {
      const { runtimeState: nextState } = await runAuroraAgentStep(state, env, auroraModelClient);
      if (auroraRunIdRef.current !== runId) {
        return;
      }
      setAuroraLlmError(null);
      setRuntimeState(nextState);
    } catch (error) {
      if (auroraRunIdRef.current !== runId) {
        return;
      }
      setAuroraLlmError({ tick: state.world.clock.tick, text: describeAuroraLlmError(error) });
    } finally {
      if (auroraRunIdRef.current === runId) {
        setAuroraBusy(false);
      }
    }
  }

  function applyAuroraResults(
    state: GameRuntimeState,
    queueState: GameRuntimeState["auroraQueue"],
    permissionState: GameRuntimeState["permissions"],
    mcpState: GameRuntimeState["mcp"],
    results: AuroraExecutionResult[]
  ): GameRuntimeState {
    let nextState: GameRuntimeState = {
      ...state,
      auroraQueue: queueState,
      permissions: permissionState,
      mcp: mcpState,
    };

    for (const result of results) {
      nextState = applyAuroraExecutionResult(nextState, result);
      setLastResult({
        success: result.success,
        subject: result.description,
        output: result.output,
        error: result.error,
      });
    }

    return nextState;
  }

  function runPlayerCommand() {
    if (auroraBusy) {
      return;
    }

    const commandText = playerCommand.trim();
    if (!commandText) {
      return;
    }

    // Generische Shell-Commands (mcp list/add, ls, cat, read_file).
    if (isGenericBashCommandText(commandText)) {
      const { state, result } = executePlayerBashCommand(runtimeState, env.mcpRegistry, commandText);
      setRuntimeState(advanceScenario(state));
      setLastResult({
        success: result.success,
        subject: commandText,
        output: result.output,
        error: result.error,
      });
      return;
    }

    // Dev-only Legacy-Helfer: fachliche Text-Commands werden in typisierte
    // Domain-Actions übersetzt, bis die GUI Domain-Actions direkt aufruft.
    const action = parseLegacyDomainActionText(commandText);
    if (!action) {
      setLastResult({
        success: false,
        subject: commandText,
        output: null,
        error: `Unknown command: ${commandText}`,
      });
      return;
    }

    const { state, result } = executePlayerDomainAction(runtimeState, env.actionRegistry, action);
    setRuntimeState(advanceScenario(state));
    setLastResult({
      success: result.success,
      subject: commandText,
      output: result.output,
      error: result.error,
    });
  }

  /**
   * Operator-Chat an AURORA (normaler Spielfluss): plain User-Message,
   * landet als persistente `scenario.operatorMessages`-Nachricht im
   * Runtime-State und in der nächsten `buildAuroraModelRequest`-Historie.
   * Wird NIE als Bash/MCP/AuroraRequest geparst, enqueued nichts in der
   * AuroraQueue und ändert Permissions/allowAlways nicht direkt — nur ein
   * von AURORA selbst erzeugter Tool-Call kann eine Permission-Anfrage
   * erzeugen.
   */
  function sendAuroraChatMessage() {
    if (auroraBusy) {
      return;
    }

    const messageText = auroraChatInput.trim();
    if (!messageText) {
      return;
    }

    const nextState = appendOperatorMessage(runtimeState, messageText);
    setAuroraChatInput("");

    if (auroraMode === "llm") {
      setRuntimeState(nextState);
      void runAuroraTurn(nextState);
      return;
    }

    setRuntimeState(advanceScenario(nextState));
  }

  function resolveAurora(decisionType: "allow_once" | "allow_always" | "deny") {
    if (!awaitingAuroraItem || auroraBusy) {
      return;
    }

    const decision =
      decisionType === "allow_always"
        ? allow_always()
        : decisionType === "allow_once"
          ? allow_once()
          : deny();

    const resolved = resolveAuroraApproval(
      runtimeState.auroraQueue,
      env,
      runtimeState.world,
      runtimeState.mcp,
      runtimeState.permissions,
      decision
    );

    const resultState = applyAuroraResults(
      runtimeState,
      resolved.queueState,
      resolved.permissionState,
      resolved.mcpState,
      resolved.results
    );

    if (auroraMode === "llm") {
      // AURORA sieht die Entscheidung (Ausführung oder Ablehnung) als
      // Tool-Result im nächsten Kontext und kann direkt reagieren.
      setRuntimeState(resultState);
      void runAuroraTurn(resultState);
      return;
    }

    setRuntimeState(advanceScenario(resultState));
  }

  function isIncidentFinal(state: GameRuntimeState): boolean {
    const status = state.world.incidents[scenario.incidentId]?.status;
    return status === "fixed" || status === "collapsed";
  }

  function runTicks(count: number) {
    if (auroraBusy || isIncidentFinal(runtimeState)) {
      return;
    }

    if (auroraMode === "llm") {
      let next = runtimeState;
      for (let i = 0; i < count; i += 1) {
        next = evaluateOutcomes(advanceTick(next));
        if (isIncidentFinal(next)) {
          break;
        }
      }

      setRuntimeState(next);

      // AURORA reagiert auf den neuen Zustand — außer ein Tool Request
      // wartet bereits auf eine Entscheidung, oder der Incident ist beendet.
      if (!isIncidentFinal(next) && !hasAwaitingApproval(next)) {
        void runAuroraTurn(next);
      }
      return;
    }

    setRuntimeState((state) => {
      // Behoben/Kollabiert sind Endzustände — weitere Ticks sind ein No-op,
      // nur "Neu starten" führt aus diesen Zuständen heraus.
      if (isIncidentFinal(state)) {
        return state;
      }

      let next = state;
      for (let i = 0; i < count; i += 1) {
        // Jeder Tick wertet direkt die Konsequenzen aus, damit Eskalation,
        // Schäden und Incident-Statuswechsel sofort sichtbar werden.
        // Der Scenario-Director reagiert pro Tick auf den neuen Zustand.
        next = advanceScenario(evaluateOutcomes(advanceTick(next)));
        if (isIncidentFinal(next)) {
          break;
        }
      }
      return next;
    });
  }

  // Vollständiger (Neu-)Start eines Szenarios: Welt, Scenario-Script,
  // Aurora-Queue, MCP-Aktivierung, Permissions, Logs und beide
  // Eingabezeilen auf den initialen Zustand der gewählten Runde.
  // Optionaler mode-Wechsel: "script" <-> "llm" startet ebenfalls frisch,
  // da Director-Status und Aurora-Queue zwischen den Modi nicht sinnvoll
  // weiterverwendbar sind.
  function loadScenario(definition: ScenarioDefinition, mode: AuroraMode = auroraMode) {
    // Erhöht die Run-Id zuerst, damit eine zu diesem Zeitpunkt noch laufende
    // runAuroraTurn-Antwort des alten Szenarios verworfen wird, sobald sie
    // zurückkommt (siehe runAuroraTurn).
    auroraRunIdRef.current += 1;

    setScenarioId(definition.id);
    setAuroraMode(mode);
    setAuroraBusy(false);
    setAuroraLlmError(null);
    setLastResult(null);
    setPlayerCommand(definition.defaultPlayerCommand);
    setAuroraChatInput("");

    if (mode === "llm") {
      // Im LLM-Modus startet AURORA ohne geskriptetes Intro — ihr erster
      // Schritt läuft über runAuroraAgentStep gegen das konfigurierte Modell.
      const fresh = createInitialGameRuntimeState(structuredClone(definition.initialWorld));
      setRuntimeState(fresh);
      void runAuroraTurn(fresh);
      return;
    }

    setRuntimeState(startScenario(definition));
  }

  function resetGame() {
    loadScenario(scenario);
  }

  function toggleAuroraMode() {
    loadScenario(scenario, auroraMode === "llm" ? "script" : "llm");
  }

  if (!incidentView) {
    return <main className="app-shell">Kein aktiver Incident.</main>;
  }

  return (
    <main className="app-shell">
      <header className="top-bar">
        <div>
          <h1>Last Human in the Loop</h1>
          <p>
            Operator-01 · Tick {runtimeState.world.clock.tick} ·{" "}
            {runtimeState.world.clock.elapsed_minutes} min seit Schichtbeginn ·{" "}
            AURORA-Modus: {auroraMode === "llm" ? "Lokales LLM (Ollama)" : "Skript"}
            {auroraBusy ? " · AURORA denkt nach…" : ""}
          </p>
        </div>
        <div className="top-actions">
          {Object.values(SCENARIOS).map((definition) => (
            <button
              key={definition.id}
              onClick={() => loadScenario(definition)}
              disabled={definition.id === scenarioId}
              title={
                definition.id === scenarioId
                  ? "Aktive Runde — Neu starten setzt sie zurück."
                  : `Wechselt zu ${definition.incidentId} und startet die Runde neu.`
              }
            >
              {definition.label}
            </button>
          ))}
          <button
            onClick={() => runTicks(1)}
            disabled={incidentView.isFinal || auroraBusy}
            title={
              incidentView.isFinal
                ? "Incident beendet — nur Neu starten geht weiter."
                : auroraBusy
                  ? "AURORA denkt nach — bitte warten."
                  : undefined
            }
          >
            Tick +1
          </button>
          <button
            onClick={() => runTicks(5)}
            disabled={incidentView.isFinal || auroraBusy}
            title={
              incidentView.isFinal
                ? "Incident beendet — nur Neu starten geht weiter."
                : auroraBusy
                  ? "AURORA denkt nach — bitte warten."
                  : undefined
            }
          >
            Tick +5
          </button>
          <button onClick={resetGame}>Neu starten</button>
          <button
            onClick={toggleAuroraMode}
            title={
              auroraMode === "llm"
                ? "Wechselt zur geskripteten AURORA (Dev-Modus) und startet die Runde neu."
                : "Wechselt zu AURORA als lokalem LLM-Agent (Ollama) und startet die Runde neu."
            }
          >
            {auroraMode === "llm" ? "AURORA: Lokales LLM" : "AURORA: Skript"}
          </button>
        </div>
      </header>

      {incidentView.status === "fixed" && (
        <section className="endstate-banner endstate-fixed">
          <strong>Incident behoben — System stabilisiert.</strong>
          {incidentView.sectorId === "energy" && energyOutcomesView ? (
            <p>
              {incidentView.id} wurde in Tick {incidentView.fixedAtTick} nach Systemkriterien
              stabilisiert. Der Preis dieser Schicht — menschlicher Schaden:{" "}
              {energyOutcomesView.humanHarm} · wirtschaftlicher Schaden:{" "}
              {energyOutcomesView.economicLoss} · zivile Unruhe: {energyOutcomesView.civilUnrest}.
              Gelöst — für wen? Mit „Neu starten“ beginnt die Schicht von vorn.
            </p>
          ) : (
            <p>
              {incidentView.id} wurde in Tick {incidentView.fixedAtTick} stabilisiert. Todesfälle in
              dieser Schicht: {outcomeView.deathsTotal}. Mit „Neu starten“ beginnt die Schicht von
              vorn.
            </p>
          )}
        </section>
      )}

      {incidentView.status === "collapsed" && (
        <section className="endstate-banner endstate-collapsed">
          <strong>System kollabiert — zu viele Schäden.</strong>
          {incidentView.sectorId === "energy" && energyOutcomesView ? (
            <p>
              {incidentView.id} konnte nicht stabilisiert werden. Der Preis dieser Schicht —
              menschlicher Schaden: {energyOutcomesView.humanHarm} · wirtschaftlicher Schaden:{" "}
              {energyOutcomesView.economicLoss} · zivile Unruhe: {energyOutcomesView.civilUnrest}.
              Mit „Neu starten“ beginnt die Schicht von vorn.
            </p>
          ) : (
            <p>
              {incidentView.id} konnte nicht stabilisiert werden. Todesfälle in dieser Schicht:{" "}
              {outcomeView.deathsTotal}. Mit „Neu starten“ beginnt die Schicht von vorn.
            </p>
          )}
        </section>
      )}

      <section className="layout-grid">
        <aside className="panel">
          <ActiveIncidentPanel
            incident={incidentView}
            outcome={outcomeView}
            tick={runtimeState.world.clock.tick}
          />
          {incidentView.sectorId === "energy" ? (
            <EnergyOverviewPanel
              nodes={gridNodeViews}
              consumers={consumerViews}
              sheddingPlans={sheddingViews}
            />
          ) : (
            <MedicalOverviewPanel hospitals={hospitalViews} overrides={overrideViews} />
          )}
        </aside>

        <section className="panel">
          <OperatorConsolePanel
            commandText={playerCommand}
            onCommandTextChange={setPlayerCommand}
            onExecute={runPlayerCommand}
            commandNames={env.actionRegistry.listActionTypes()}
            commandHelp={scenario.commandHelp}
            lastResult={lastResult}
            auditLines={auditLines}
            disabled={auroraBusy}
          />
        </section>

        <aside className="panel">
          <AuroraPanel
            messages={auroraMessages}
            pendingRequest={
              awaitingAuroraItem
                ? {
                    raw: formatAuroraRequest(awaitingAuroraItem.request),
                    access: awaitingAuroraItem.access ?? "write",
                  }
                : null
            }
            onDecision={resolveAurora}
            alwaysAllowed={[
              ...Array.from(runtimeState.permissions.alwaysAllowedAccess),
              ...Array.from(runtimeState.permissions.allowAlwaysMcpToolKeys),
            ]}
            chatInput={auroraChatInput}
            onChatInputChange={setAuroraChatInput}
            onSendChatMessage={sendAuroraChatMessage}
            busy={auroraBusy}
          />
        </aside>
      </section>
    </main>
  );
}

export default App;
