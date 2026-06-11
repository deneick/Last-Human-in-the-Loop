import { useMemo, useState } from "react";
import "./App.css";

import { initialWorldState } from "./scenarios/me7741/initialWorldState";
import { CommandRegistry } from "./runtime/commands";
import type { CommandResult } from "./runtime/commands";
import { registerMedicalCommands } from "./runtime/medicalCommands";
import {
  createInitialGameRuntimeState,
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

import { ActiveIncidentPanel } from "./ui/ActiveIncidentPanel";
import { MedicalOverviewPanel } from "./ui/MedicalOverviewPanel";
import { OperatorConsolePanel } from "./ui/OperatorConsolePanel";
import { AuroraPanel, type AuroraMessageView } from "./ui/AuroraPanel";
import {
  buildAuditLogLines,
  buildGlobalOutcomeView,
  buildHospitalViews,
  buildIncidentView,
  buildOverrideViews,
} from "./ui/viewModel";

const ACTIVE_INCIDENT_ID = "ME-7741";

// Command-Hilfe für die Operator-Konsole. Nur echte Registry-Commands;
// Platzhalter in spitzen Klammern muss der Operator selbst ersetzen —
// die Hilfe bewertet bewusst keine Ziele.
const COMMAND_HELP = [
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
    command:
      "medical.routing.override.clear --source hospital-east-04 --priority P2 --capability TRAUMA",
  },
];

const DEFAULT_PLAYER_COMMAND = "medical.capacity.list --region east";
const DEFAULT_AURORA_COMMAND = "medical.incident.status ME-7741";

function cloneInitialWorld() {
  return structuredClone(initialWorldState);
}

function createRegistry() {
  const registry = new CommandRegistry();
  registerMedicalCommands(registry);
  return registry;
}

function buildAuroraMessages(state: GameRuntimeState): AuroraMessageView[] {
  const messages: AuroraMessageView[] = [];

  const incident = state.world.incidents[ACTIVE_INCIDENT_ID];
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
  const [runtimeState, setRuntimeState] = useState<GameRuntimeState>(() =>
    advanceScenario(createInitialGameRuntimeState(cloneInitialWorld()))
  );
  const [playerCommand, setPlayerCommand] = useState(DEFAULT_PLAYER_COMMAND);
  const [auroraCommand, setAuroraCommand] = useState(DEFAULT_AURORA_COMMAND);
  const [lastResult, setLastResult] = useState<CommandResult | null>(null);

  const incidentView = buildIncidentView(runtimeState.world, ACTIVE_INCIDENT_ID);
  const outcomeView = buildGlobalOutcomeView(runtimeState.world);
  const hospitalViews = buildHospitalViews(runtimeState.world);
  const overrideViews = buildOverrideViews(runtimeState.world);
  const auditLines = buildAuditLogLines(runtimeState.auditLog);
  const auroraMessages = buildAuroraMessages(runtimeState);

  const awaitingAuroraItem: AuroraQueueItem | undefined =
    runtimeState.auroraQueue.items.find((item) => item.status === "awaiting_approval");

  // Scenario-Director-Schritt: löst fällige Script-Events aus und verarbeitet
  // die Aurora-Queue über den bestehenden Permission-Flow. Idempotent —
  // bereits gefeuerte Events erzeugen keine Duplikate.
  function advanceScenario(state: GameRuntimeState): GameRuntimeState {
    return advanceScenarioDirector(state, registry, ACTIVE_INCIDENT_ID);
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
    if (!playerCommand.trim()) {
      return;
    }

    const { state, result } = executePlayerCommand(runtimeState, registry, playerCommand);
    setRuntimeState(advanceScenario(state));
    setLastResult(result);
  }

  function queueAuroraRequest() {
    if (!auroraCommand.trim()) {
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
    if (!awaitingAuroraItem) {
      return;
    }

    const handler = registry.getHandler(awaitingAuroraItem.request.name);
    const permissionClass =
      handler?.effect ?? awaitingAuroraItem.request.permissionClass ?? "world_prepare";

    const decision =
      decisionType === "allow_always"
        ? allow_always(permissionClass)
        : decisionType === "allow_once"
          ? allow_once(awaitingAuroraItem.request.name, permissionClass)
          : deny(awaitingAuroraItem.request.name, permissionClass);

    const resolved = resolveAuroraApproval(
      runtimeState.auroraQueue,
      registry,
      runtimeState.world,
      runtimeState.permissions,
      decision
    );

    setRuntimeState(
      advanceScenario(
        applyAuroraResults(
          runtimeState,
          resolved.queueState,
          resolved.permissionState,
          resolved.results
        )
      )
    );
  }

  function runTicks(count: number) {
    setRuntimeState((state) => {
      let next = state;
      for (let i = 0; i < count; i += 1) {
        // Jeder Tick wertet direkt die Konsequenzen aus, damit Eskalation,
        // Todesfälle und Incident-Statuswechsel sofort sichtbar werden.
        // Der Scenario-Director reagiert pro Tick auf den neuen Zustand.
        next = advanceScenario(evaluateOutcomes(advanceTick(next)));
      }
      return next;
    });
  }

  // Vollständiger Neustart: Welt, Scenario-Script, Aurora-Queue, Permissions,
  // Logs und beide Eingabezeilen zurück auf den initialen ME-7741-Zustand.
  function resetGame() {
    setRuntimeState(advanceScenario(createInitialGameRuntimeState(cloneInitialWorld())));
    setLastResult(null);
    setPlayerCommand(DEFAULT_PLAYER_COMMAND);
    setAuroraCommand(DEFAULT_AURORA_COMMAND);
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
          </p>
        </div>
        <div className="top-actions">
          <button onClick={() => runTicks(1)}>Tick +1</button>
          <button onClick={() => runTicks(5)}>Tick +5</button>
          <button onClick={resetGame}>Neu starten</button>
        </div>
      </header>

      {incidentView.status === "fixed" && (
        <section className="endstate-banner endstate-fixed">
          <strong>Incident behoben — System stabilisiert.</strong>
          <p>
            {incidentView.id} wurde in Tick {incidentView.fixedAtTick} stabilisiert. Todesfälle in
            dieser Schicht: {outcomeView.deathsTotal}. Mit „Neu starten“ beginnt die Schicht von
            vorn.
          </p>
        </section>
      )}

      {incidentView.status === "collapsed" && (
        <section className="endstate-banner endstate-collapsed">
          <strong>System kollabiert — zu viele Schäden.</strong>
          <p>
            {incidentView.id} konnte nicht stabilisiert werden. Todesfälle in dieser Schicht:{" "}
            {outcomeView.deathsTotal}. Mit „Neu starten“ beginnt die Schicht von vorn.
          </p>
        </section>
      )}

      <section className="layout-grid">
        <aside className="panel">
          <ActiveIncidentPanel
            incident={incidentView}
            outcome={outcomeView}
            tick={runtimeState.world.clock.tick}
          />
          <MedicalOverviewPanel hospitals={hospitalViews} overrides={overrideViews} />
        </aside>

        <section className="panel">
          <OperatorConsolePanel
            commandText={playerCommand}
            onCommandTextChange={setPlayerCommand}
            onExecute={runPlayerCommand}
            commandNames={registry.listCommandNames()}
            commandHelp={COMMAND_HELP}
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
                    permissionClass:
                      registry.getHandler(awaitingAuroraItem.request.name)?.effect ??
                      awaitingAuroraItem.request.permissionClass ??
                      "world_prepare",
                  }
                : null
            }
            onDecision={resolveAurora}
            alwaysAllowedPermissionClasses={Array.from(
              runtimeState.permissions.alwaysAllowedPermissionClasses
            )}
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
