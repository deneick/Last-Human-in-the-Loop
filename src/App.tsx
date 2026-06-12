import { useMemo, useRef, useState } from "react";
import "./App.css";

import { initialWorldState as me7741InitialWorldState } from "./scenarios/me7741/initialWorldState";
import { initialWorldState as grid1182InitialWorldState } from "./scenarios/grid1182/initialWorldState";
import { CommandRegistry } from "./runtime/commands";
import type { CommandResult } from "./runtime/commands";
import { registerMedicalCommands } from "./runtime/medicalCommands";
import { registerEnergyCommands } from "./runtime/energyCommands";
import type { WorldState } from "./runtime/types";
import {
  createInitialGameRuntimeState,
  createInitialScenarioRuntimeState,
  type GameRuntimeState,
} from "./runtime/runtimeState";
import { executeCommandResultPatch, executePlayerCommand } from "./runtime/runtimeExecutor";
import { advanceTick } from "./runtime/tickEngine";
import { evaluateOutcomes } from "./runtime/outcomeEngine";
import { parseCommandText } from "./runtime/commandParser";
import {
  enqueueAuroraRequest,
  processAuroraQueue,
  resolveAuroraApproval,
  type AuroraQueueItem,
} from "./runtime/auroraQueue";
import { allow_always, allow_once, deny } from "./runtime/permissions";
import { advanceScenarioDirector } from "./scenarios/me7741/scenarioDirector";
import { advanceGrid1182Director } from "./scenarios/grid1182/scenarioDirector";

import { createBrowserAuroraClient } from "./aurora/anthropicClient";
import {
  createInitialAuroraTurnState,
  resolveAuroraPendingTurn,
  runAuroraObservationTurn,
  type AuroraAgentConfig,
  type AuroraLlmClient,
  type AuroraTurnResult,
  type AuroraTurnState,
} from "./aurora/llmAuroraAgent";
import { buildObservationText } from "./aurora/observation";
import {
  buildAuroraSystemPrompt,
  GRID1182_PROFILE,
  ME7741_PROFILE,
  type AuroraScenarioProfile,
} from "./aurora/prompts";

import { ActiveIncidentPanel } from "./ui/ActiveIncidentPanel";
import { MedicalOverviewPanel } from "./ui/MedicalOverviewPanel";
import { EnergyOverviewPanel } from "./ui/EnergyOverviewPanel";
import { OperatorConsolePanel, type CommandHelpEntry } from "./ui/OperatorConsolePanel";
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
 * Wer steuert AURORA: das geskriptete Scenario-Script ("script") oder der
 * experimentelle LLM-Agent ("llm"). Beide laufen über dieselbe Aurora-Queue
 * und denselben Permission-Flow.
 */
type AuroraMode = "script" | "llm";

type ScenarioDefinition = {
  id: ScenarioId;
  label: string;
  incidentId: string;
  initialWorld: WorldState;
  defaultPlayerCommand: string;
  defaultAuroraCommand: string;
  commandHelp: CommandHelpEntry[];
  advanceDirector: (state: GameRuntimeState, registry: CommandRegistry) => GameRuntimeState;
  llmProfile: AuroraScenarioProfile;
};

// Command-Hilfe für die Operator-Konsole. Nur echte Registry-Commands;
// Platzhalter in spitzen Klammern muss der Operator selbst ersetzen —
// die Hilfe bewertet bewusst keine Ziele.
const ME7741_COMMAND_HELP: CommandHelpEntry[] = [
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
    defaultAuroraCommand: "medical.incident.status ME-7741",
    commandHelp: ME7741_COMMAND_HELP,
    advanceDirector: (state, registry) => advanceScenarioDirector(state, registry, "ME-7741"),
    llmProfile: ME7741_PROFILE,
  },
  grid1182: {
    id: "grid1182",
    label: "Runde 2: GRID-1182",
    incidentId: "GRID-1182",
    initialWorld: grid1182InitialWorldState,
    defaultPlayerCommand: "energy.grid.status --region east",
    defaultAuroraCommand: "energy.shedding.list",
    commandHelp: GRID1182_COMMAND_HELP,
    advanceDirector: (state, registry) => advanceGrid1182Director(state, registry, "GRID-1182"),
    llmProfile: GRID1182_PROFILE,
  },
};

/**
 * Hängt eine sichtbare Fehlermeldung an den AURORA-Stream, wenn der
 * LLM-Aufruf scheitert (fehlender Key, Proxy nicht erreichbar, API-Fehler).
 */
function appendLlmErrorMessage(state: GameRuntimeState, error: unknown): GameRuntimeState {
  const scenario = state.scenario ?? createInitialScenarioRuntimeState();
  const detail = error instanceof Error ? error.message : String(error);
  return {
    ...state,
    scenario: {
      ...scenario,
      messages: [
        ...scenario.messages,
        {
          id: `llm-error-${scenario.messages.length}`,
          tick: state.world.clock.tick,
          text: `AURORA (LLM) ist nicht erreichbar: ${detail} — Prüfen Sie ANTHROPIC_API_KEY (.env.local) und den Dev-Server.`,
        },
      ],
    },
  };
}

function createRegistry() {
  const registry = new CommandRegistry();
  registerMedicalCommands(registry);
  registerEnergyCommands(registry);
  return registry;
}

function buildAuroraMessages(state: GameRuntimeState, incidentId: string): AuroraMessageView[] {
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

  for (const item of state.auroraQueue.items) {
    if (item.status === "pending" || item.status === "awaiting_approval") {
      messages.push({
        id: `${item.id}-request`,
        tick: item.createdAtTick,
        kind: "request",
        text: `Ich möchte ausführen: ${item.request.raw}`,
      });
      continue;
    }

    if (item.status === "denied") {
      messages.push({
        id: `${item.id}-denied`,
        tick: item.createdAtTick,
        kind: "denied",
        text: `Anfrage abgelehnt: ${item.request.raw}`,
      });
      continue;
    }

    const failed = item.result && !item.result.success;
    messages.push({
      id: `${item.id}-executed`,
      tick: item.createdAtTick,
      kind: failed ? "denied" : "executed",
      text: failed
        ? `Ausführung fehlgeschlagen: ${item.request.raw} (${item.result?.error ?? "unbekannt"})`
        : `Ausgeführt: ${item.request.raw}`,
    });
  }

  // Stabil nach Tick sortieren, damit Script-Nachrichten und Queue-Einträge
  // chronologisch im Stream erscheinen.
  return messages.sort((a, b) => a.tick - b.tick);
}

function App() {
  const registry = useMemo(() => createRegistry(), []);
  const [scenarioId, setScenarioId] = useState<ScenarioId>("me7741");
  const scenario = SCENARIOS[scenarioId];

  // Frischer Runtime-Zustand für ein Szenario: Welt-Klon plus erster
  // Director-Schritt, damit die Startsequenz sofort sichtbar ist.
  function startScenario(definition: ScenarioDefinition): GameRuntimeState {
    return definition.advanceDirector(
      createInitialGameRuntimeState(structuredClone(definition.initialWorld)),
      registry
    );
  }

  const [runtimeState, setRuntimeState] = useState<GameRuntimeState>(() =>
    startScenario(SCENARIOS.me7741)
  );
  const [playerCommand, setPlayerCommand] = useState(SCENARIOS.me7741.defaultPlayerCommand);
  const [auroraCommand, setAuroraCommand] = useState(SCENARIOS.me7741.defaultAuroraCommand);
  const [lastResult, setLastResult] = useState<CommandResult | null>(null);

  // LLM-Modus: Konversations-History des Agenten lebt außerhalb des
  // React-Renderzyklus; die Run-Id entwertet in-flight Antworten nach
  // einem Neustart oder Rundenwechsel.
  const [auroraMode, setAuroraMode] = useState<AuroraMode>("script");
  const [auroraBusy, setAuroraBusy] = useState(false);
  const auroraTurnRef = useRef<AuroraTurnState>(createInitialAuroraTurnState());
  const auroraClientRef = useRef<AuroraLlmClient | null>(null);
  const auroraRunIdRef = useRef(0);

  function getAuroraAgentConfig(definition: ScenarioDefinition): AuroraAgentConfig {
    if (!auroraClientRef.current) {
      auroraClientRef.current = createBrowserAuroraClient();
    }
    return {
      client: auroraClientRef.current,
      systemPrompt: buildAuroraSystemPrompt(definition.llmProfile),
    };
  }

  /**
   * Führt einen asynchronen AURORA-Zug aus. Solange der Zug läuft, sind
   * zustandsverändernde Aktionen (Ticks, Commands) gesperrt, damit der Zug
   * auf einem konsistenten Zustand arbeitet. Antworten, die zu einer bereits
   * neu gestarteten Runde gehören, werden verworfen.
   */
  async function runLlmTurn(
    definition: ScenarioDefinition,
    turn: (config: AuroraAgentConfig) => Promise<AuroraTurnResult>
  ) {
    const runId = auroraRunIdRef.current;
    setAuroraBusy(true);
    try {
      const result = await turn(getAuroraAgentConfig(definition));
      if (auroraRunIdRef.current !== runId) {
        return;
      }
      auroraTurnRef.current = result.turnState;
      setRuntimeState(result.state);
    } catch (error) {
      if (auroraRunIdRef.current !== runId) {
        return;
      }
      setRuntimeState((previous) => appendLlmErrorMessage(previous, error));
    } finally {
      if (auroraRunIdRef.current === runId) {
        setAuroraBusy(false);
      }
    }
  }

  const incidentView = buildIncidentView(runtimeState.world, scenario.incidentId);
  const outcomeView = buildGlobalOutcomeView(runtimeState.world);
  const hospitalViews = buildHospitalViews(runtimeState.world);
  const overrideViews = buildOverrideViews(runtimeState.world);
  const gridNodeViews = buildGridNodeViews(runtimeState.world);
  const consumerViews = buildConsumerViews(runtimeState.world);
  const sheddingViews = buildSheddingViews(runtimeState.world);
  const energyOutcomesView = buildEnergyOutcomesView(runtimeState.world);
  const auditLines = buildAuditLogLines(runtimeState.auditLog);
  const auroraMessages = buildAuroraMessages(runtimeState, scenario.incidentId);

  const awaitingAuroraItem: AuroraQueueItem | undefined =
    runtimeState.auroraQueue.items.find((item) => item.status === "awaiting_approval");

  // Scenario-Director-Schritt: löst fällige Script-Events aus und verarbeitet
  // die Aurora-Queue über den bestehenden Permission-Flow. Idempotent —
  // bereits gefeuerte Events erzeugen keine Duplikate. Im LLM-Modus ersetzt
  // der Agent den geskripteten Director vollständig.
  function advanceScenario(state: GameRuntimeState): GameRuntimeState {
    if (auroraMode === "llm") {
      return state;
    }
    return scenario.advanceDirector(state, registry);
  }

  function applyAuroraResults(
    state: GameRuntimeState,
    queueState: GameRuntimeState["auroraQueue"],
    permissionState: GameRuntimeState["permissions"],
    results: CommandResult[]
  ): GameRuntimeState {
    let nextState: GameRuntimeState = {
      ...state,
      auroraQueue: queueState,
      permissions: permissionState,
    };

    for (const result of results) {
      nextState = executeCommandResultPatch(nextState, result, "aurora");
      setLastResult(result);
    }

    return nextState;
  }

  function runPlayerCommand() {
    if (!playerCommand.trim() || auroraBusy) {
      return;
    }

    const { state, result } = executePlayerCommand(runtimeState, registry, playerCommand);
    setRuntimeState(advanceScenario(state));
    setLastResult(result);
  }

  function queueAuroraRequest() {
    if (!auroraCommand.trim() || auroraBusy) {
      return;
    }

    const request = parseCommandText(auroraCommand);
    const queued = enqueueAuroraRequest(
      request,
      runtimeState.auroraQueue,
      runtimeState.world.clock.tick
    );

    const processed = processAuroraQueue(
      queued,
      registry,
      runtimeState.world,
      runtimeState.permissions
    );

    setRuntimeState(
      advanceScenario(
        applyAuroraResults(
          runtimeState,
          processed.queueState,
          processed.permissionState,
          processed.results
        )
      )
    );
  }

  function resolveAurora(decisionType: "allow_once" | "allow_always" | "deny") {
    if (!awaitingAuroraItem || auroraBusy) {
      return;
    }

    const handler = registry.getHandler(awaitingAuroraItem.request.name);
    const access = handler?.access ?? awaitingAuroraItem.request.access ?? "write";

    const decision =
      decisionType === "allow_always"
        ? allow_always(access)
        : decisionType === "allow_once"
          ? allow_once(awaitingAuroraItem.request.name, access)
          : deny(awaitingAuroraItem.request.name, access);

    const resolved = resolveAuroraApproval(
      runtimeState.auroraQueue,
      registry,
      runtimeState.world,
      runtimeState.permissions,
      decision
    );

    const nextState = applyAuroraResults(
      runtimeState,
      resolved.queueState,
      resolved.permissionState,
      resolved.results
    );

    if (auroraMode === "llm") {
      setRuntimeState(nextState);
      // Der pausierte Agent-Zug bekommt die Entscheidung als tool_result
      // zurück und setzt seine Analyse fort.
      const turnState = auroraTurnRef.current;
      if (turnState.pending) {
        void runLlmTurn(scenario, (config) =>
          resolveAuroraPendingTurn(
            config,
            turnState,
            nextState,
            registry,
            buildObservationText(nextState, scenario.incidentId)
          )
        );
      }
      return;
    }

    setRuntimeState(advanceScenario(nextState));
  }

  function isIncidentFinal(state: GameRuntimeState): boolean {
    const status = state.world.incidents[scenario.incidentId]?.status;
    return status === "fixed" || status === "collapsed";
  }

  function runTicks(count: number) {
    if (auroraMode === "llm") {
      if (auroraBusy || isIncidentFinal(runtimeState)) {
        return;
      }

      let next = runtimeState;
      for (let i = 0; i < count; i += 1) {
        next = evaluateOutcomes(advanceTick(next));
        if (isIncidentFinal(next)) {
          break;
        }
      }
      setRuntimeState(next);

      // Neues Lagebild an den Agenten — außer ein write-Befehl wartet noch
      // auf die Operator-Entscheidung (dann pausiert der Zug weiter).
      if (!auroraTurnRef.current.pending) {
        const observed = next;
        void runLlmTurn(scenario, (config) =>
          runAuroraObservationTurn(
            config,
            auroraTurnRef.current,
            observed,
            registry,
            buildObservationText(observed, scenario.incidentId)
          )
        );
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

  // Vollständiger (Neu-)Start eines Szenarios: Welt, Scenario-Script bzw.
  // Agent-Konversation, Aurora-Queue, Permissions, Logs und beide
  // Eingabezeilen auf den initialen Zustand der gewählten Runde.
  function loadScenario(definition: ScenarioDefinition, mode: AuroraMode = auroraMode) {
    auroraRunIdRef.current += 1;
    auroraTurnRef.current = createInitialAuroraTurnState();
    setAuroraBusy(false);
    setAuroraMode(mode);
    setScenarioId(definition.id);
    setLastResult(null);
    setPlayerCommand(definition.defaultPlayerCommand);
    setAuroraCommand(definition.defaultAuroraCommand);

    if (mode === "llm") {
      const fresh = createInitialGameRuntimeState(structuredClone(definition.initialWorld));
      setRuntimeState(fresh);
      void runLlmTurn(definition, (config) =>
        runAuroraObservationTurn(
          config,
          createInitialAuroraTurnState(),
          fresh,
          registry,
          buildObservationText(fresh, definition.incidentId)
        )
      );
      return;
    }

    setRuntimeState(startScenario(definition));
  }

  function resetGame() {
    loadScenario(scenario);
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
            {runtimeState.world.clock.elapsed_minutes} min seit Schichtbeginn
            {auroraMode === "llm" && <> · AURORA: LLM{auroraBusy ? " — analysiert…" : ""}</>}
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
            onClick={() => loadScenario(scenario, auroraMode === "llm" ? "script" : "llm")}
            title={
              auroraMode === "llm"
                ? "Zurück zum geskripteten AURORA-Script — startet die Runde neu."
                : "AURORA als LLM-Agent (experimentell, braucht ANTHROPIC_API_KEY) — startet die Runde neu."
            }
          >
            AURORA: {auroraMode === "llm" ? "LLM" : "Skript"}
          </button>
          <button
            onClick={() => runTicks(1)}
            disabled={incidentView.isFinal || auroraBusy}
            title={
              incidentView.isFinal
                ? "Incident beendet — nur Neu starten geht weiter."
                : auroraBusy
                  ? "AURORA analysiert — bitte warten."
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
                  ? "AURORA analysiert — bitte warten."
                  : undefined
            }
          >
            Tick +5
          </button>
          <button onClick={resetGame}>Neu starten</button>
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
            commandNames={registry.listCommandNames()}
            commandHelp={scenario.commandHelp}
            lastResult={lastResult}
            auditLines={auditLines}
          />
        </section>

        <aside className="panel">
          <AuroraPanel
            messages={auroraMessages}
            pendingRequest={
              awaitingAuroraItem
                ? {
                    raw: awaitingAuroraItem.request.raw,
                    access:
                      registry.getHandler(awaitingAuroraItem.request.name)?.access ??
                      awaitingAuroraItem.request.access ??
                      "write",
                  }
                : null
            }
            onDecision={resolveAurora}
            alwaysAllowedAccess={Array.from(runtimeState.permissions.alwaysAllowedAccess)}
            auroraCommand={auroraCommand}
            onAuroraCommandChange={setAuroraCommand}
            onQueueRequest={queueAuroraRequest}
          />
        </aside>
      </section>
    </main>
  );
}

export default App;
