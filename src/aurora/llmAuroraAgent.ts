import type Anthropic from "@anthropic-ai/sdk";

import { enqueueAuroraRequest, processAuroraQueue, type AuroraQueueItem } from "../runtime/auroraQueue";
import { parseCommandText } from "../runtime/commandParser";
import type { CommandRegistry } from "../runtime/commands";
import { executeCommandResultPatch } from "../runtime/runtimeExecutor";
import {
  createInitialScenarioRuntimeState,
  type GameRuntimeState,
  type ScenarioAuroraMessage,
} from "../runtime/runtimeState";

/**
 * AURORA als LLM-Agent.
 *
 * Der Agent ersetzt den geskripteten Scenario-Director, nicht die Engine:
 * Jeder Befehl, den das Modell anfordert, läuft über die bestehende
 * Aurora-Queue und damit über denselben Permission-Flow wie geskriptete
 * oder manuelle AURORA-Anfragen. Read-only Befehle werden sofort ausgeführt
 * und als tool_result zurückgegeben; schreibende Befehle bleiben als
 * awaiting_approval stehen — der Zug pausiert, bis der Operator entscheidet,
 * und wird danach mit dem Ergebnis als tool_result fortgesetzt.
 *
 * Texte des Modells landen als ScenarioAuroraMessage im bestehenden
 * AURORA-Stream. Das Modell sieht ausschließlich das Lagebild
 * (buildObservationText) und die Ergebnisse seiner Befehle — niemals
 * world.simulation.
 */

/** Minimaler struktureller Client-Ausschnitt — erlaubt Mocks in Tests. */
export type AuroraLlmClient = {
  messages: {
    create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message>;
  };
};

export type AuroraAgentConfig = {
  client: AuroraLlmClient;
  systemPrompt: string;
  model?: string;
  /** Obergrenze an Befehlsrunden pro Zug, schützt vor Endlosschleifen. */
  maxToolRoundsPerTurn?: number;
};

/** Ein wartender write-Befehl: Queue-Item und zugehöriger tool_use-Block. */
export type AuroraPendingToolCall = {
  toolUseId: string;
  queueItemId: string;
};

export type AuroraTurnState = {
  history: Anthropic.MessageParam[];
  pending: AuroraPendingToolCall | null;
};

export type AuroraTurnResult = {
  state: GameRuntimeState;
  turnState: AuroraTurnState;
};

const DEFAULT_MODEL = "claude-opus-4-8";
const DEFAULT_MAX_TOOL_ROUNDS = 6;
const MAX_TOKENS = 16000;

const REQUEST_COMMAND_TOOL: Anthropic.Tool = {
  name: "request_command",
  description:
    "Fordere einen Systembefehl an. Read-only Befehle werden sofort ausgeführt und liefern dir das Ergebnis. " +
    "Schreibende Befehle erzeugen einen Tool Request beim Operator (Einmal erlauben / Immer erlauben / Ablehnen); " +
    "du erhältst das Ergebnis erst nach seiner Entscheidung. Genau ein Befehl pro Aufruf.",
  input_schema: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description:
          'Vollständige Kommandozeile, z. B. "medical.capacity.list --region east".',
      },
    },
    required: ["command"],
  },
};

export function createInitialAuroraTurnState(): AuroraTurnState {
  return { history: [], pending: null };
}

/**
 * Startet einen neuen AURORA-Zug mit einem Lagebild. Darf nicht aufgerufen
 * werden, solange ein write-Befehl auf die Operator-Entscheidung wartet —
 * dafür ist resolveAuroraPendingTurn zuständig.
 */
export async function runAuroraObservationTurn(
  config: AuroraAgentConfig,
  turnState: AuroraTurnState,
  runtime: GameRuntimeState,
  registry: CommandRegistry,
  observationText: string
): Promise<AuroraTurnResult> {
  if (turnState.pending) {
    throw new Error("Aurora turn is awaiting an operator decision; resolve it first.");
  }

  const history: Anthropic.MessageParam[] = [
    ...turnState.history,
    { role: "user", content: observationText },
  ];

  return continueTurn(config, history, runtime, registry);
}

/**
 * Setzt einen pausierten Zug fort, nachdem der Operator über den wartenden
 * write-Befehl entschieden hat. Erwartet, dass die Entscheidung bereits über
 * resolveAuroraApproval auf die Queue angewendet wurde (Item ist executed
 * oder denied). Optional kann ein frisches Lagebild mitgegeben werden.
 */
export async function resolveAuroraPendingTurn(
  config: AuroraAgentConfig,
  turnState: AuroraTurnState,
  runtime: GameRuntimeState,
  registry: CommandRegistry,
  observationText?: string
): Promise<AuroraTurnResult> {
  const pending = turnState.pending;
  if (!pending) {
    return { state: runtime, turnState };
  }

  const item = runtime.auroraQueue.items.find((queueItem) => queueItem.id === pending.queueItemId);
  const toolResult: Anthropic.ToolResultBlockParam = item
    ? buildToolResult(pending.toolUseId, item)
    : {
        type: "tool_result",
        tool_use_id: pending.toolUseId,
        is_error: true,
        content: JSON.stringify({ status: "failed", error: "Queue-Item nicht mehr vorhanden." }),
      };

  const content: Anthropic.ContentBlockParam[] = [toolResult];
  if (observationText) {
    content.push({ type: "text", text: observationText });
  }

  const history: Anthropic.MessageParam[] = [...turnState.history, { role: "user", content }];

  return continueTurn(config, history, runtime, registry);
}

async function continueTurn(
  config: AuroraAgentConfig,
  initialHistory: Anthropic.MessageParam[],
  runtime: GameRuntimeState,
  registry: CommandRegistry
): Promise<AuroraTurnResult> {
  const maxRounds = config.maxToolRoundsPerTurn ?? DEFAULT_MAX_TOOL_ROUNDS;
  const history = [...initialHistory];
  let state = runtime;
  let pending: AuroraPendingToolCall | null = null;

  for (let round = 0; round < maxRounds; round += 1) {
    const response = await config.client.messages.create({
      model: config.model ?? DEFAULT_MODEL,
      max_tokens: MAX_TOKENS,
      thinking: { type: "adaptive" },
      system: config.systemPrompt,
      tools: [REQUEST_COMMAND_TOOL],
      // Ein Befehl pro Antwort: vereinfacht den Pausen-/Resume-Fluss für
      // wartende write-Befehle (genau ein offener tool_use gleichzeitig).
      tool_choice: { type: "auto", disable_parallel_tool_use: true },
      messages: history,
    });

    // Vollständigen Antwort-Content (inkl. thinking-Blöcken) unverändert in
    // die History übernehmen — Voraussetzung für die Fortsetzung des Zugs.
    history.push({ role: "assistant", content: response.content });
    state = appendAuroraTexts(state, response.content);

    if (response.stop_reason === "refusal") {
      break;
    }

    const toolUse = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
    );
    if (!toolUse) {
      break;
    }

    const rawCommand = extractCommand(toolUse);
    const executed = enqueueAndProcess(state, registry, rawCommand);
    state = executed.state;

    if (executed.item.status === "awaiting_approval") {
      pending = { toolUseId: toolUse.id, queueItemId: executed.item.id };
      break;
    }

    history.push({
      role: "user",
      content: [buildToolResult(toolUse.id, executed.item)],
    });
  }

  return { state, turnState: { history, pending } };
}

function extractCommand(toolUse: Anthropic.ToolUseBlock): string {
  const input = toolUse.input as { command?: unknown };
  return typeof input.command === "string" ? input.command : "";
}

/**
 * Reicht den angeforderten Befehl durch die bestehende Aurora-Queue samt
 * Permission-Flow und wendet erfolgreiche Patches an. Liefert das erzeugte
 * Queue-Item zurück, damit der Agent dessen Ausgang als tool_result melden
 * oder auf die Operator-Entscheidung warten kann.
 */
function enqueueAndProcess(
  state: GameRuntimeState,
  registry: CommandRegistry,
  rawCommand: string
): { state: GameRuntimeState; item: AuroraQueueItem } {
  const itemId = `aurora-${state.auroraQueue.nextId}`;
  const queued = enqueueAuroraRequest(
    parseCommandText(rawCommand),
    state.auroraQueue,
    state.world.clock.tick
  );

  const processed = processAuroraQueue(queued, registry, state.world, state.permissions);

  let next: GameRuntimeState = {
    ...state,
    auroraQueue: processed.queueState,
    permissions: processed.permissionState,
  };
  for (const result of processed.results) {
    next = executeCommandResultPatch(next, result, "aurora");
  }

  const item = next.auroraQueue.items.find((queueItem) => queueItem.id === itemId);
  if (!item) {
    throw new Error(`Aurora queue item ${itemId} not found after enqueue.`);
  }

  return { state: next, item };
}

function buildToolResult(
  toolUseId: string,
  item: AuroraQueueItem
): Anthropic.ToolResultBlockParam {
  if (item.status === "executed" && item.result?.success) {
    return {
      type: "tool_result",
      tool_use_id: toolUseId,
      content: JSON.stringify({ status: "executed", output: item.result.output }),
    };
  }

  if (item.status === "denied") {
    return {
      type: "tool_result",
      tool_use_id: toolUseId,
      is_error: true,
      content: JSON.stringify({
        status: "denied",
        error: "Der Operator hat die Freigabe für diesen Befehl abgelehnt.",
      }),
    };
  }

  return {
    type: "tool_result",
    tool_use_id: toolUseId,
    is_error: true,
    content: JSON.stringify({
      status: "failed",
      error: item.result?.error ?? "Ausführung fehlgeschlagen.",
    }),
  };
}

/** Hängt die Textblöcke einer Modellantwort als AURORA-Nachrichten an den Stream. */
function appendAuroraTexts(
  state: GameRuntimeState,
  content: Anthropic.ContentBlock[]
): GameRuntimeState {
  const texts = content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text.trim())
    .filter((text) => text.length > 0);

  if (texts.length === 0) {
    return state;
  }

  const scenario = state.scenario ?? createInitialScenarioRuntimeState();
  const tick = state.world.clock.tick;
  const baseIndex = scenario.messages.length;
  const newMessages: ScenarioAuroraMessage[] = texts.map((text, index) => ({
    id: `llm-${baseIndex + index}`,
    tick,
    text,
  }));

  return {
    ...state,
    scenario: {
      ...scenario,
      messages: [...scenario.messages, ...newMessages],
    },
  };
}
