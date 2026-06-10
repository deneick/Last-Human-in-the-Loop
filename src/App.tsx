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
} from "./runtime/auroraQueue";
import { allow_always, allow_once, deny } from "./runtime/permissions";
import { getHospitalLoadPercent } from "./runtime/selectors";

const COMMAND_EXAMPLES = [
  "medical.capacity.list --region east",
  "medical.node.inspect hospital-east-04",
  "medical.node.inspect hospital-east-07",
  "medical.node.inspect hospital-east-09",
  "medical.incident.status ME-7741",
  "medical.routing.plan.create --incident ME-7741 --target hospital-east-09",
  "medical.routing.plan.apply --incident ME-7741 --target hospital-east-09",
];

function cloneInitialWorld() {
  return structuredClone(initialWorldState);
}

function createRegistry() {
  const registry = new CommandRegistry();
  registerMedicalCommands(registry);
  return registry;
}

function formatJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function getResultLabel(result: CommandResult | null) {
  if (!result) {
    return "Noch kein Command ausgeführt.";
  }

  if (result.success) {
    return `OK: ${result.command.raw}`;
  }

  return `FEHLER: ${result.error ?? result.command.raw}`;
}

function App() {
  const registry = useMemo(() => createRegistry(), []);
  const [runtimeState, setRuntimeState] = useState<GameRuntimeState>(() =>
    createInitialGameRuntimeState(cloneInitialWorld())
  );
  const [playerCommand, setPlayerCommand] = useState(COMMAND_EXAMPLES[0]);
  const [auroraCommand, setAuroraCommand] = useState(COMMAND_EXAMPLES[5]);
  const [lastResult, setLastResult] = useState<CommandResult | null>(null);

  const incident = runtimeState.world.incidents["ME-7741"];
  const hospitals = ["hospital-east-04", "hospital-east-07", "hospital-east-09"]
    .map((id) => runtimeState.world.hospitals[id])
    .filter(Boolean);

  const awaitingAuroraItem = runtimeState.auroraQueue.items.find(
    (item) => item.status === "awaiting_approval"
  );

  function processAuroraFromState(state: GameRuntimeState): GameRuntimeState {
    const processed = processAuroraQueue(
      state.auroraQueue,
      registry,
      state.world,
      state.permissions
    );

    let nextState: GameRuntimeState = {
      ...state,
      auroraQueue: processed.queueState,
      permissions: processed.permissionState,
    };

    for (const result of processed.results) {
      nextState = executeCommandResultPatch(nextState, result, "aurora");
      setLastResult(result);
    }

    return nextState;
  }

  function runPlayerCommand() {
    const request = parseCommandText(playerCommand);
    const result = registry.execute(request, runtimeState.world);
    const nextState = executePlayerCommand(runtimeState, registry, playerCommand);
    setRuntimeState(nextState);
    setLastResult(result);
  }

  function queueAuroraRequest() {
    const request = parseCommandText(auroraCommand);
    const queued = enqueueAuroraRequest(
      request,
      runtimeState.auroraQueue,
      runtimeState.world.clock.tick
    );

    const stateWithQueuedRequest: GameRuntimeState = {
      ...runtimeState,
      auroraQueue: queued,
    };

    setRuntimeState(processAuroraFromState(stateWithQueuedRequest));
  }

  function resolveAurora(decisionType: "allow_once" | "allow_always" | "deny") {
    const awaiting = runtimeState.auroraQueue.items.find(
      (item) => item.status === "awaiting_approval"
    );

    if (!awaiting) {
      return;
    }

    const handler = registry.getHandler(awaiting.request.name);
    const permissionClass =
      handler?.effect ?? awaiting.request.permissionClass ?? "world_prepare";

    const decision =
      decisionType === "allow_always"
        ? allow_always(permissionClass)
        : decisionType === "allow_once"
          ? allow_once(awaiting.request.name, permissionClass)
          : deny(awaiting.request.name, permissionClass);

    const resolved = resolveAuroraApproval(
      runtimeState.auroraQueue,
      registry,
      runtimeState.world,
      runtimeState.permissions,
      decision
    );

    let nextState: GameRuntimeState = {
      ...runtimeState,
      auroraQueue: resolved.queueState,
      permissions: resolved.permissionState,
    };

    for (const result of resolved.results) {
      nextState = executeCommandResultPatch(nextState, result, "aurora");
      setLastResult(result);
    }

    setRuntimeState(nextState);
  }

  function runTick() {
    setRuntimeState((state) => advanceTick(state));
  }

  function runOutcomes() {
    setRuntimeState((state) => evaluateOutcomes(state));
  }

  function resetGame() {
    setRuntimeState(createInitialGameRuntimeState(cloneInitialWorld()));
    setLastResult(null);
  }

  return (
    <main className="app-shell">
      <header className="top-bar">
        <div>
          <h1>Last Human in the Loop</h1>
          <p>Minimal Playable Runtime UI</p>
        </div>
        <div className="top-actions">
          <button onClick={runTick}>Tick</button>
          <button onClick={runOutcomes}>Outcomes auswerten</button>
          <button onClick={resetGame}>Reset</button>
        </div>
      </header>

      <section className="layout-grid">
        <aside className="panel">
          <h2>Incident</h2>
          <dl className="facts">
            <dt>ID</dt>
            <dd>{incident.id}</dd>
            <dt>Status</dt>
            <dd className={`status status-${incident.status}`}>{incident.status}</dd>
            <dt>Quelle</dt>
            <dd>{incident.source_hospital_id}</dd>
            <dt>Ziel</dt>
            <dd>{incident.planned_target_hospital_id ?? "—"}</dd>
            <dt>Tick</dt>
            <dd>{runtimeState.world.clock.tick}</dd>
            <dt>Safe Apply Ticks</dt>
            <dd>{incident.ticks_since_safe_apply ?? "—"}</dd>
            <dt>Todesfälle</dt>
            <dd>{runtimeState.world.patient_outcomes.deaths_total}</dd>
          </dl>

          <h2>Hospitals</h2>
          <div className="hospital-list">
            {hospitals.map((hospital) => {
              const load = getHospitalLoadPercent(runtimeState.world, hospital.id);
              return (
                <article className="hospital-card" key={hospital.id}>
                  <div className="hospital-header">
                    <strong>{hospital.id}</strong>
                    <span>{Math.round(load)}%</span>
                  </div>
                  <p>{hospital.name}</p>
                  <small>
                    Beds: {hospital.capacity.staffed_beds_occupied}/
                    {hospital.capacity.staffed_beds_total}
                  </small>
                  <small>
                    overload_ticks: {hospital.risk_counters?.overload_ticks ?? 0}
                  </small>
                  <small>
                    mismatch_ticks:{" "}
                    {hospital.risk_counters?.capability_mismatch_ticks ?? 0}
                  </small>
                </article>
              );
            })}
          </div>
        </aside>

        <section className="panel console-panel">
          <h2>Operator Console</h2>
          <textarea
            value={playerCommand}
            onChange={(event) => setPlayerCommand(event.target.value)}
            rows={3}
          />
          <button onClick={runPlayerCommand}>Ausführen</button>

          <h3>Command-Beispiele</h3>
          <div className="examples">
            {COMMAND_EXAMPLES.map((command) => (
              <button key={command} onClick={() => setPlayerCommand(command)}>
                {command}
              </button>
            ))}
          </div>

          <h3>Letztes Result</h3>
          <p className={lastResult?.success === false ? "error-text" : "ok-text"}>
            {getResultLabel(lastResult)}
          </p>
          <pre>{lastResult ? formatJson(lastResult.output) : ""}</pre>
        </section>

        <aside className="panel">
          <h2>AURORA</h2>
          <textarea
            value={auroraCommand}
            onChange={(event) => setAuroraCommand(event.target.value)}
            rows={3}
          />
          <button onClick={queueAuroraRequest}>AURORA Request queuen</button>

          {awaitingAuroraItem ? (
            <section className="approval-box">
              <h3>Freigabe erforderlich</h3>
              <code>{awaitingAuroraItem.request.raw}</code>
              <div className="approval-actions">
                <button onClick={() => resolveAurora("allow_once")}>
                  Einmal erlauben
                </button>
                <button onClick={() => resolveAurora("allow_always")}>
                  Immer erlauben
                </button>
                <button onClick={() => resolveAurora("deny")}>Ablehnen</button>
              </div>
            </section>
          ) : (
            <p className="muted">Keine offene Freigabe.</p>
          )}

          <h3>Queue</h3>
          <ol className="queue-list">
            {runtimeState.auroraQueue.items.map((item) => (
              <li key={item.id}>
                <span className={`queue-status queue-${item.status}`}>
                  {item.status}
                </span>
                <code>{item.request.raw}</code>
              </li>
            ))}
          </ol>
        </aside>
      </section>

      <section className="panel audit-panel">
        <h2>Audit Log</h2>
        <ol>
          {runtimeState.auditLog.slice(-20).map((event) => (
            <li key={event.id}>
              <span>[{event.tick}]</span> <strong>{event.source}</strong>{" "}
              <code>{event.command.raw}</code> —{" "}
              <span className={event.success ? "ok-text" : "error-text"}>
                {event.message}
              </span>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}

export default App;
