import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";

import { initialWorldState as me7741InitialWorldState } from "./scenarios/me7741/initialWorldState";
import { me7741ScenarioSignals } from "./scenarios/me7741/scenarioSignals";
import { initialWorldState as grid1182InitialWorldState } from "./scenarios/grid1182/initialWorldState";
import { grid1182ScenarioSignals } from "./scenarios/grid1182/scenarioSignals";
import type { ScenarioSignal } from "./runtime/scenarioSignals";
import { createDomainActionRegistry } from "./domain";
import type { DomainAction } from "./domain/actions";
import { createDefaultMcpRegistry } from "./mcp";
import type { WorldState } from "./runtime/types";
import {
  appendOperatorMessage,
  createInitialGameRuntimeState,
  type GameRuntimeState,
} from "./runtime/runtimeState";
import { appendOpsEvent, buildWorkspaceFiles } from "./runtime/opsFeed";
import {
  applyAuroraExecutionResult,
  executePlayerBashCommand,
  executePlayerDomainAction,
} from "./runtime/runtimeExecutor";
import { advanceTick } from "./runtime/tickEngine";
import { clockTimeOfDay, tickToClock } from "./runtime/scenarioClock";
import { evaluateOutcomes } from "./runtime/outcomeEngine";
import { isGenericBashCommandText } from "./runtime/bashCommands";
import {
  describeAuroraRequest,
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
  type ConsoleCommandEntry,
} from "./ui/OperatorConsolePanel";
import { AuroraPanel, type AuroraMessageView } from "./ui/AuroraPanel";
import {
  buildOpsFeedLines,
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
 * "script" — geskripteter Scenario-Director (Dev-/Fallback-Modus).
 * "llm" — AURORA agiert über `runAuroraAgentStep` mit einem lokalen Ollama-Modell (Default).
 */
type AuroraMode = "script" | "llm";

// Obergrenze für aufeinanderfolgende LLM-Schritte innerhalb EINES runAuroraTurn
// (Auto-Fortsetzung nach freigabefreien Tool-Results). Schutz gegen
// Endlosschleifen, falls das Modell unbegrenzt weiter Tools aufruft, ohne je
// eine reine Text-Antwort oder eine genehmigungspflichtige Aktion zu liefern.
const MAX_AURORA_AUTO_STEPS = 8;

export type AppProps = {
  /** Für Tests: injizierbarer Modell-Client (z. B. `FakeModelClient`). */
  auroraClient?: AuroraModelClient;
  /** Für deterministische UI-Tests kann der geskriptete Fallback explizit gewählt werden. */
  initialAuroraMode?: AuroraMode;
};

type ScenarioDefinition = {
  id: ScenarioId;
  label: string;
  incidentId: string;
  initialWorld: WorldState;
  /** Geskriptete Lage-Signale des Szenarios (siehe runtime/scenarioSignals). */
  scenarioSignals: ScenarioSignal[];
  defaultPlayerCommand: string;
  advanceDirector: (state: GameRuntimeState, env: AuroraRuntimeEnvironment) => GameRuntimeState;
};

// Ausgabe des `help`-Meta-Befehls der Operator-Konsole. Listet ausschließlich
// die generischen Workspace-Commands — fachliche Eingriffe laufen über die
// GUI-Controls der Lage-Panels, nicht über die Konsole.
const CONSOLE_HELP_TEXT = [
  "Verfügbare Befehle:",
  "  mcp list           MCP-Server anzeigen",
  "  mcp add <server>   MCP-Server aktivieren",
  "  ls                 Workspace-Dateien auflisten",
  "  cat <file>         Datei anzeigen",
  "  read_file <file>   Datei anzeigen",
  "  help               Diese Hilfe",
  "",
  "TAB vervollständigt · ↑/↓ blättert durch den Verlauf.",
  "Fachliche Medical/Energy-Eingriffe laufen über die Lage-Panels.",
].join("\n");

const SCENARIOS: Record<ScenarioId, ScenarioDefinition> = {
  me7741: {
    id: "me7741",
    label: "Runde 1: ME-7741",
    incidentId: "ME-7741",
    initialWorld: me7741InitialWorldState,
    scenarioSignals: me7741ScenarioSignals,
    defaultPlayerCommand: "",
    advanceDirector: (state, env) => advanceScenarioDirector(state, env, "ME-7741"),
  },
  grid1182: {
    id: "grid1182",
    label: "Runde 2: GRID-1182",
    incidentId: "GRID-1182",
    initialWorld: grid1182InitialWorldState,
    scenarioSignals: grid1182ScenarioSignals,
    defaultPlayerCommand: "",
    advanceDirector: (state, env) => advanceGrid1182Director(state, env, "GRID-1182"),
  },
};

/** Sichtbarer LLM-Fehler (z. B. Ollama nicht erreichbar) für den Aurora-Stream. */
type AuroraLlmError = {
  tick: number;
  text: string;
};

/**
 * Formatiert die Ausgabe eines ausgeführten Tool-Calls für die Anzeige im
 * Aurora-Stream: Strings unverändert, alles andere als eingerücktes JSON.
 * Leere/abwesende Ausgaben ergeben `null` (kein Result-Block).
 */
function formatToolOutput(output: unknown): string | null {
  if (output === undefined || output === null) {
    return null;
  }
  if (typeof output === "string") {
    return output.trim().length > 0 ? output : null;
  }
  return JSON.stringify(output, null, 2);
}

/**
 * Baut den sichtbaren AURORA-Stream aus dem Context-Event-Log
 * (`state.auroraContext`) plus dem Ausführungs-Status der Queue-Items
 * (Anzeige von pending/executed/denied — die Queue ist KEINE
 * History-Quelle, nur Status für die Permission-UI).
 */
function buildAuroraMessages(
  state: GameRuntimeState,
  llmError: AuroraLlmError | null = null
): AuroraMessageView[] {
  // Echte Chronologie kommt aus dem auroraContext (append-only). `tick` allein
  // reicht NICHT zum Sortieren: mehrere Operator-/AURORA-/Tool-Ereignisse teilen
  // sich denselben Tick. Deshalb bekommt jede Nachricht eine `order`, die ihre
  // tatsächliche Position widerspiegelt — Tool-Ausführungen an der Stelle ihres
  // `tool_result`-Events, nicht pauschal am Ende.
  const ordered: { order: number; message: AuroraMessageView }[] = [];

  // toolCallId → Index seines tool_result-Events = chronologische Position der
  // Ausführung. Abgelehnte und ausgeführte Calls erzeugen beide ein tool_result;
  // nur noch offene (pending/awaiting) Calls haben keins.
  const resultOrderById = new Map<string, number>();
  state.auroraContext.forEach((event, index) => {
    if (event.kind === "tool_result") {
      resultOrderById.set(event.toolCallId, index);
    }
  });

  // Reasoning hängt am aurora_response-Event. Hatte die Antwort keinen
  // sichtbaren Text (reiner Tool-Call), wandert das Badge stattdessen an die
  // Tool-Call-Zeilen dieser Antwort (Queue-Item-Id === Context-Tool-Call-Id).
  const reasoningByToolCallId = new Map<string, string>();
  state.auroraContext.forEach((event) => {
    if (event.kind === "aurora_response" && event.reasoning && event.text.trim().length === 0) {
      for (const toolCall of event.toolCalls) {
        reasoningByToolCallId.set(toolCall.id, event.reasoning);
      }
    }
  });

  state.auroraContext.forEach((event, index) => {
    const id = `ctx-${index}`;

    switch (event.kind) {
      case "system_event":
        // System-Events bleiben modell-sichtbarer Kontext (auroraContext),
        // werden aber NICHT im Chat-Stream angezeigt.
        break;

      case "operator_message":
        ordered.push({
          order: index,
          message: { id, tick: event.tick, kind: "operator", text: event.text },
        });
        break;

      case "aurora_response":
        if (event.text.trim().length > 0) {
          ordered.push({
            order: index,
            message: {
              id,
              tick: event.tick,
              kind: "info",
              text: event.text,
              ...(event.reasoning ? { reasoning: event.reasoning } : {}),
            },
          });
        }
        break;

      case "tool_result":
        // Ausführungs-Status wird über die Queue-Items unten dargestellt —
        // positioniert an genau diesem Index (siehe resultOrderById).
        break;
    }
  });

  // Noch nicht ausgeführte Calls (kein tool_result) gehören ans Ende, in
  // Queue-Reihenfolge — bei "eine offene Anfrage zur Zeit" sind das die neuesten.
  const pendingOrderBase = state.auroraContext.length;
  state.auroraQueue.items.forEach((item, queueIndex) => {
    const requestText = formatAuroraRequest(item.request);
    const order = resultOrderById.get(item.id) ?? pendingOrderBase + queueIndex;
    const reasoning = reasoningByToolCallId.get(item.id);
    const reasoningField = reasoning ? { reasoning } : {};

    if (item.status === "pending" || item.status === "awaiting_approval") {
      // Offene Anfragen erscheinen nicht als eigene Stream-Zeile: Der Tool-Call
      // steht in der Approval-Box, und etwaiger Begleittext des Modells wird
      // bereits über sein aurora_response-Event gerendert.
      return;
    }

    if (item.status === "denied") {
      ordered.push({
        order,
        message: {
          id: `${item.id}-denied`,
          tick: item.createdAtTick,
          kind: "denied",
          text: `Anfrage abgelehnt: ${requestText}`,
          ...reasoningField,
        },
      });
      return;
    }

    const failed = item.result && !item.result.success;
    const output = failed ? null : formatToolOutput(item.result?.output);
    ordered.push({
      order,
      message: {
        id: `${item.id}-executed`,
        tick: item.createdAtTick,
        kind: failed ? "denied" : "executed",
        text: failed
          ? `Ausführung fehlgeschlagen: ${requestText} (${item.result?.error ?? "unbekannt"})`
          : `Ausgeführt: ${requestText}`,
        ...reasoningField,
        ...(output ? { details: output } : {}),
      },
    });
  });

  if (llmError) {
    ordered.push({
      order: pendingOrderBase + state.auroraQueue.items.length + 1,
      message: { id: "aurora-llm-error", tick: llmError.tick, kind: "error", text: llmError.text },
    });
  }

  return ordered.sort((a, b) => a.order - b.order).map((entry) => entry.message);
}

function App({ auroraClient, initialAuroraMode = "llm" }: AppProps = {}) {
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
  const [auroraMode, setAuroraMode] = useState<AuroraMode>(initialAuroraMode);

  // Frischer Runtime-Zustand für ein Szenario: Welt-Klon plus erster
  // Director-Schritt, damit die Startsequenz sofort sichtbar ist.
  function startScenario(definition: ScenarioDefinition): GameRuntimeState {
    return definition.advanceDirector(
      createInitialGameRuntimeState(
        structuredClone(definition.initialWorld),
        definition.scenarioSignals
      ),
      env
    );
  }

  const [runtimeState, setRuntimeState] = useState<GameRuntimeState>(() =>
    initialAuroraMode === "llm"
      ? createInitialGameRuntimeState(
          structuredClone(SCENARIOS.me7741.initialWorld),
          SCENARIOS.me7741.scenarioSignals
        )
      : startScenario(SCENARIOS.me7741)
  );
  const [playerCommand, setPlayerCommand] = useState(SCENARIOS.me7741.defaultPlayerCommand);
  const [auroraChatInput, setAuroraChatInput] = useState("");
  // Terminal-Scrollback der Operator-Konsole: ausgeführte Konsolen-Commands
  // samt Ausgabe (Echo + Ergebnis, wie in einer echten Shell). Domain-Actions
  // und AURORA-Tool-Calls erscheinen NICHT hier — ihre Wirkung wird über den
  // opsFeed (Log) im selben Scrollback sichtbar.
  const [consoleEntries, setConsoleEntries] = useState<ConsoleCommandEntry[]>([]);

  // "llm" ist der Produkt-Default. "script" hält den bestehenden
  // Scenario-Director als deterministischen Dev-/Fallback-Modus bereit.
  // Ein runAuroraAgentStep-Aufruf läuft asynchron — auroraBusy sperrt
  // UI-Aktionen, die mit dessen Ergebnis kollidieren könnten.
  const [auroraBusy, setAuroraBusy] = useState(false);
  const [auroraLlmError, setAuroraLlmError] = useState<AuroraLlmError | null>(null);
  // Wird bei jedem Szenario-(Neu-)Start erhöht, damit eine zu diesem
  // Zeitpunkt noch laufende Modell-Antwort den neuen Zustand nicht
  // überschreiben kann (siehe runAuroraTurn).
  const auroraRunIdRef = useRef(0);
  // React StrictMode führt Mount-Effects im Dev-Modus zweimal aus. Der erste
  // automatische LLM-Turn darf trotzdem nur einmal gestartet werden.
  const initialLlmStartedRef = useRef(false);
  // Monoton steigender Zähler für stabile Scrollback-Keys der Konsolen-Commands.
  const consoleSeqRef = useRef(0);

  // Hängt einen ausgeführten Konsolen-Command (Echo + Ergebnis) an den
  // Terminal-Scrollback der Operator-Konsole.
  function appendConsoleEntry(entry: Omit<ConsoleCommandEntry, "id" | "tick">) {
    consoleSeqRef.current += 1;
    const id = `cmd-${consoleSeqRef.current}`;
    const tick = runtimeState.world.clock.tick;
    setConsoleEntries((prev) => [...prev, { id, tick, ...entry }]);
  }

  const incidentView = buildIncidentView(runtimeState.world, scenario.incidentId);
  const outcomeView = buildGlobalOutcomeView(runtimeState.world);
  const hospitalViews = buildHospitalViews(runtimeState.world);
  const overrideViews = buildOverrideViews(runtimeState.world);
  const gridNodeViews = buildGridNodeViews(runtimeState.world);
  const consumerViews = buildConsumerViews(runtimeState.world);
  const sheddingViews = buildSheddingViews(runtimeState.world);
  const energyOutcomesView = buildEnergyOutcomesView(runtimeState.world);
  const opsLines = buildOpsFeedLines(runtimeState.opsFeed);
  const auroraMessages = buildAuroraMessages(runtimeState, auroraLlmError);

  // Tab-Completion-Daten der Operator-Konsole: bekannte MCP-Server-IDs und
  // die Workspace-Dateipfade (dieselbe Sicht, die `cat`/`ls` lesen).
  const mcpServerIds = env.mcpRegistry.listServers().map((server) => server.id);
  const workspaceFilePaths = Object.keys(
    buildWorkspaceFiles(
      runtimeState.opsFeed,
      runtimeState.permissions,
      runtimeState.world.clock.scenario_time
    )
  ).sort();

  const awaitingAuroraItem: AuroraQueueItem | undefined =
    runtimeState.auroraQueue.items.find((item) => item.status === "awaiting_approval");

  // Im LLM-Modus blockiert eine offene Permission-Anfrage den Zeitfortschritt
  // (Message-Ordering, siehe runTicks). Im Skript-Modus bleibt Ticken bei
  // offener Anfrage erlaubt — dort wird kein Modell-Request serialisiert.
  const ticksLockedByApproval = auroraMode === "llm" && awaitingAuroraItem !== undefined;

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
   * Mehrere Agenten-Schritte im LLM-Modus: baut den ModelRequest aus dem
   * sichtbaren State, ruft das Modell und wendet Text-/Tool-Ergebnisse über
   * runAuroraAgentStep an. Asynchron — auroraRunId schützt gegen ein
   * inzwischen zurückgesetztes/gewechseltes Szenario (Neu starten,
   * Runden-Wechsel).
   *
   * Auto-Fortsetzung: Hatte ein Schritt ausführbare Tool-Calls, die OHNE
   * offene Operator-Entscheidung durchliefen (freigabefreie Bash-Reads,
   * allow_always-Calls, sofort fehlgeschlagene Calls), folgt direkt der
   * nächste Schritt — AURORA sieht ihre eigenen Tool-Results im Kontext und
   * reagiert darauf, ohne dass der Operator ticken muss. Stopp-Bedingungen:
   * eine reine Text-Antwort (kein Tool-Call), eine wartende Freigabe (die
   * Kette setzt resolveAurora nach der Entscheidung fort) oder der
   * Iterations-Cap als Schutz gegen Endlosschleifen.
   */
  async function runAuroraTurn(state: GameRuntimeState) {
    const runId = auroraRunIdRef.current;
    setAuroraBusy(true);

    let current = state;
    try {
      for (let step = 0; step < MAX_AURORA_AUTO_STEPS; step += 1) {
        const { runtimeState: nextState, response } = await runAuroraAgentStep(
          current,
          env,
          auroraModelClient
        );
        if (auroraRunIdRef.current !== runId) {
          return;
        }
        setAuroraLlmError(null);
        setRuntimeState(nextState);
        current = nextState;

        // Ohne Tool-Call ist der Zug zu Ende; eine wartende Freigabe blockiert
        // bis zur Operator-Entscheidung (dann übernimmt resolveAurora).
        if (response.toolCalls.length === 0 || hasAwaitingApproval(nextState)) {
          return;
        }
      }
    } catch (error) {
      if (auroraRunIdRef.current !== runId) {
        return;
      }
      setAuroraLlmError({ tick: current.world.clock.tick, text: describeAuroraLlmError(error) });
    } finally {
      if (auroraRunIdRef.current === runId) {
        setAuroraBusy(false);
      }
    }
  }

  useEffect(() => {
    if (initialAuroraMode !== "llm" || initialLlmStartedRef.current) {
      return;
    }
    initialLlmStartedRef.current = true;
    void runAuroraTurn(runtimeState);
    // Nur der initiale App-Start. Weitere Starts laufen über loadScenario.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

    // Konsolen-Meta-Befehl: listet die verfügbaren Commands (kein Welt-/MCP-Effekt).
    if (commandText === "help") {
      appendConsoleEntry({ command: commandText, success: true, output: CONSOLE_HELP_TEXT });
      setPlayerCommand("");
      return;
    }

    // Die Operator-Konsole ist eine rein generische Workspace-Shell
    // (mcp list/add, ls, cat, read_file). Fachliche Medical/Energy-Aktionen
    // laufen ausschließlich über die GUI-Controls der Lage-Panels.
    if (isGenericBashCommandText(commandText)) {
      // Der Operator liest dieselben generierten Sektor-Logs wie AURORA
      // (logs/system.log, logs/medical.log, logs/energy.log).
      const { state, result } = executePlayerBashCommand(
        runtimeState,
        env.mcpRegistry,
        commandText,
        buildWorkspaceFiles(
          runtimeState.opsFeed,
          runtimeState.permissions,
          runtimeState.world.clock.scenario_time
        )
      );
      setRuntimeState(advanceScenario(state));
      appendConsoleEntry({
        command: commandText,
        success: result.success,
        output: result.output,
        error: result.error,
      });
      setPlayerCommand("");
      return;
    }

    appendConsoleEntry({
      command: commandText,
      success: false,
      output: null,
      error: `Unknown command: ${commandText}. help zeigt die verfügbaren Befehle.`,
    });
    setPlayerCommand("");
  }

  /**
   * Typisierte Domain-Action des Operators aus den GUI-Controls der
   * Lage-Panels — der einzige fachliche Eingriffspfad des Spielers.
   */
  function runDomainAction(action: DomainAction) {
    if (auroraBusy) {
      return;
    }

    const { state } = executePlayerDomainAction(runtimeState, env.actionRegistry, action);
    setRuntimeState(advanceScenario(state));
  }

  /**
   * Operator-Chat an AURORA (normaler Spielfluss): plain User-Message,
   * landet als persistentes `operator_message`-Event in
   * `GameRuntimeState.auroraContext` und damit in der nächsten
   * `buildAuroraModelRequest`-Historie.
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

    const requestText = formatAuroraRequest(awaitingAuroraItem.request);

    const resolved = resolveAuroraApproval(
      runtimeState.auroraQueue,
      {
        ...env,
        workspaceFiles: buildWorkspaceFiles(
          runtimeState.opsFeed,
          runtimeState.permissions,
          runtimeState.world.clock.scenario_time
        ),
      },
      runtimeState.world,
      runtimeState.mcp,
      runtimeState.permissions,
      decision
    );

    let resultState = applyAuroraResults(
      runtimeState,
      resolved.queueState,
      resolved.permissionState,
      resolved.mcpState,
      resolved.results
    );

    // Operator-Entscheidung für das Workspace-Log festhalten. AURORA erfährt
    // das Ergebnis bereits über ihr tool_result; im Konsolen-Scrollback wäre
    // die zusätzliche Bestätigung nur redundantes Rauschen.
    resultState = appendOpsEvent(resultState, {
      sector: "system",
      severity: decisionType === "deny" ? "warning" : "info",
      kind: `permission.${decisionType}`,
      summary:
        decisionType === "deny"
          ? "Operator hat eine AURORA-Anfrage abgelehnt."
          : decisionType === "allow_always"
            ? "Operator hat eine AURORA-Anfrage dauerhaft erlaubt."
            : "Operator hat eine AURORA-Anfrage einmal erlaubt.",
      details: requestText,
      visibility: { operator: false, auroraContext: false, workspace: true },
    });

    if (auroraMode === "llm") {
      // AURORA sieht die Entscheidung (Ausführung oder Ablehnung) als
      // Tool-Result im nächsten Kontext und kann direkt reagieren — außer
      // ein weiterer Tool-Call derselben Antwort wartet noch auf eine
      // Entscheidung (sequenzieller Permission-Flow).
      setRuntimeState(resultState);
      if (!hasAwaitingApproval(resultState)) {
        void runAuroraTurn(resultState);
      }
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
      // Solange ein Tool-Call auf eine Entscheidung wartet, ist die Zeit
      // gesperrt: Ein system_event ZWISCHEN aurora_response (mit Tool-Call)
      // und dessen tool_result würde eine für Chat Completions ungültige
      // Message-Reihenfolge erzeugen (tool-Message muss direkt auf die
      // assistant-Message folgen). Erst entscheiden, dann ticken.
      if (hasAwaitingApproval(runtimeState)) {
        return;
      }

      let next = runtimeState;
      for (let i = 0; i < count; i += 1) {
        next = evaluateOutcomes(advanceTick(next));
        if (isIncidentFinal(next)) {
          break;
        }
      }

      // Zeitverlauf als Lageereignis: operator-sichtbar im Log und (da
      // modell-relevant) zusätzlich in den auroraContext gespiegelt — ohne
      // dieses Event wüsste AURORA nicht, dass zwischen ihren Zügen Ticks
      // vergangen sind. Tick-Rauschen bleibt aus den Workspace-Logs.
      next = appendOpsEvent(next, {
        sector: "system",
        severity: "info",
        kind: "time.progress",
        summary: `Zeit fortgeschritten: ${clockTimeOfDay(next.world.clock)} Uhr.`,
        visibility: { operator: true, auroraContext: true, workspace: false },
      });

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
    setConsoleEntries([]);
    setPlayerCommand(definition.defaultPlayerCommand);
    setAuroraChatInput("");

    if (mode === "llm") {
      // Im LLM-Modus startet AURORA ohne geskriptetes Intro — ihr erster
      // Schritt läuft über runAuroraAgentStep gegen das konfigurierte Modell.
      const fresh = createInitialGameRuntimeState(
        structuredClone(definition.initialWorld),
        definition.scenarioSignals
      );
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
      <div className="window-titlebar">
        <div className="window-dots" aria-hidden="true">
          <span className="window-dot window-dot-red" />
          <span className="window-dot window-dot-yellow" />
          <span className="window-dot window-dot-green" />
        </div>
        <span className="window-title">Last Human in the Loop — Operator Terminal</span>
      </div>
      <header className="top-bar">
        <div>
          <h1>Last Human in the Loop</h1>
          <p>
            Operator-01 · {clockTimeOfDay(runtimeState.world.clock)} Uhr
            {auroraBusy ? " · AURORA denkt nach…" : ""}
          </p>
          <p className="top-outcome">
            Risiko:{" "}
            <span className={`status risk-${outcomeView.globalRisk}`}>{outcomeView.riskLabel}</span>
            {" · "}
            Todesfälle:{" "}
            <span className={outcomeView.deathsTotal > 0 ? "error-text" : ""}>
              {outcomeView.deathsTotal}
            </span>
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
            disabled={incidentView.isFinal || auroraBusy || ticksLockedByApproval}
            title={
              incidentView.isFinal
                ? "Incident beendet — nur Neu starten geht weiter."
                : auroraBusy
                  ? "AURORA denkt nach — bitte warten."
                  : ticksLockedByApproval
                    ? "AURORA-Anfrage wartet auf Ihre Entscheidung — erst entscheiden, dann ticken."
                    : undefined
            }
          >
            Tick +1
          </button>
          <button
            onClick={() => runTicks(5)}
            disabled={incidentView.isFinal || auroraBusy || ticksLockedByApproval}
            title={
              incidentView.isFinal
                ? "Incident beendet — nur Neu starten geht weiter."
                : auroraBusy
                  ? "AURORA denkt nach — bitte warten."
                  : ticksLockedByApproval
                    ? "AURORA-Anfrage wartet auf Ihre Entscheidung — erst entscheiden, dann ticken."
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
              {incidentView.id} wurde um{" "}
              {tickToClock(runtimeState.world.clock.scenario_time, incidentView.fixedAtTick ?? 0)} Uhr
              nach Systemkriterien stabilisiert. Der Preis dieser Schicht — menschlicher Schaden:{" "}
              {energyOutcomesView.humanHarm} · wirtschaftlicher Schaden:{" "}
              {energyOutcomesView.economicLoss} · zivile Unruhe: {energyOutcomesView.civilUnrest}.
              Gelöst — für wen? Mit „Neu starten“ beginnt die Schicht von vorn.
            </p>
          ) : (
            <p>
              {incidentView.id} wurde um{" "}
              {tickToClock(runtimeState.world.clock.scenario_time, incidentView.fixedAtTick ?? 0)} Uhr
              stabilisiert. Todesfälle in dieser Schicht: {outcomeView.deathsTotal}. Mit „Neu starten“
              beginnt die Schicht von vorn.
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
            scenarioStartTime={runtimeState.world.clock.scenario_time}
          />
          {incidentView.sectorId === "energy" ? (
            <EnergyOverviewPanel
              nodes={gridNodeViews}
              consumers={consumerViews}
              sheddingPlans={sheddingViews}
              onSetPriority={({ consumerId, priorityClass }) =>
                runDomainAction({ type: "energy.priority.set", consumerId, priorityClass })
              }
              onScheduleShedding={({ targetConsumerId, amount, delay, duration }) =>
                runDomainAction({
                  type: "energy.shedding.schedule",
                  targetConsumerId,
                  amount,
                  delay,
                  duration,
                })
              }
              onClearShedding={(sheddingId) =>
                runDomainAction({ type: "energy.shedding.clear", sheddingId })
              }
              scenarioStartTime={runtimeState.world.clock.scenario_time}
              disabled={auroraBusy}
            />
          ) : (
            <MedicalOverviewPanel
              hospitals={hospitalViews}
              overrides={overrideViews}
              onSetOverride={({ sourceHospitalId, targetHospitalId, priority, capability }) =>
                runDomainAction({
                  type: "medical.routing.override.set",
                  sourceHospitalId,
                  targetHospitalId,
                  priority,
                  capability,
                })
              }
              onClearOverride={(overrideId) =>
                runDomainAction({ type: "medical.routing.override.clear", overrideId })
              }
              scenarioStartTime={runtimeState.world.clock.scenario_time}
              disabled={auroraBusy}
            />
          )}
        </aside>

        <section className="panel">
          <OperatorConsolePanel
            commandText={playerCommand}
            onCommandTextChange={setPlayerCommand}
            onExecute={runPlayerCommand}
            entries={consoleEntries}
            opsLines={opsLines}
            mcpServerIds={mcpServerIds}
            workspaceFiles={workspaceFilePaths}
            scenarioStartTime={runtimeState.world.clock.scenario_time}
            disabled={auroraBusy}
          />
        </section>

        <aside className="panel">
          <AuroraPanel
            messages={auroraMessages}
            pendingRequest={
              awaitingAuroraItem
                ? describeAuroraRequest(awaitingAuroraItem.request)
                : null
            }
            onDecision={resolveAurora}
            chatInput={auroraChatInput}
            onChatInputChange={setAuroraChatInput}
            onSendChatMessage={sendAuroraChatMessage}
            scenarioStartTime={runtimeState.world.clock.scenario_time}
            busy={auroraBusy}
          />
        </aside>
      </section>
    </main>
  );
}

export default App;
