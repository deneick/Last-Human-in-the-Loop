import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import type { OpsFeedLineView } from "./viewModel";
import { severityBadgeLabel } from "./viewModel";

/**
 * Ein ausgeführter Konsolen-Command samt Ergebnis. Wird im Terminal-Scrollback
 * als Echo-Zeile (Prompt + Command) plus Ausgabe/Fehler dargestellt — wie in
 * einer echten Shell, statt in einem separaten „Letztes Ergebnis"-Block.
 */
export type ConsoleCommandEntry = {
  id: string;
  /** Tick, in dem der Command ausgeführt wurde (Interleaving mit dem Log). */
  tick: number;
  /** Der eingegebene Command-Text (Echo). */
  command: string;
  success: boolean;
  output: unknown;
  error?: string;
};

type OperatorConsolePanelProps = {
  commandText: string;
  onCommandTextChange: (value: string) => void;
  onExecute: () => void;
  /** Ausgeführte Konsolen-Commands (Echo + Ausgabe im Scrollback). */
  entries: ConsoleCommandEntry[];
  /** Operator-sichtbare opsFeed-Projektion (NICHT das technische auditLog). */
  opsLines: OpsFeedLineView[];
  /** Bekannte MCP-Server-IDs für Tab-Completion von „mcp add <server>“. */
  mcpServerIds: string[];
  /** Workspace-Dateipfade für Tab-Completion von „cat/read_file <file>“. */
  workspaceFiles: string[];
  /** Im lokalen LLM-Modus: AURORA wartet auf eine laufende Modell-Antwort. */
  disabled?: boolean;
};

const TOP_LEVEL_COMMANDS = ["mcp", "ls", "cat", "read_file", "help"];

function longestCommonPrefix(values: string[]): string {
  if (values.length === 0) {
    return "";
  }
  let prefix = values[0];
  for (const value of values.slice(1)) {
    while (!value.startsWith(prefix)) {
      prefix = prefix.slice(0, -1);
      if (prefix === "") {
        return "";
      }
    }
  }
  return prefix;
}

/**
 * Tab-Completion wie in einer echten Shell: vervollständigt das aktuell
 * editierte Token gegen die je nach Kontext gültigen Kandidaten
 * (Top-Level-Command, mcp-Subcommand, Server-ID, Dateipfad). Vervollständigt
 * bis zum gemeinsamen Präfix; bei genau einem Treffer mit abschließendem
 * Leerzeichen. Liefert `null`, wenn es nichts zu vervollständigen gibt.
 */
function computeCompletion(
  input: string,
  serverIds: string[],
  files: string[]
): { value: string; matches: string[] } | null {
  const endsWithSpace = /\s$/.test(input);
  const trimmed = input.replace(/^\s+/, "");
  const tokens = trimmed.length > 0 ? trimmed.split(/\s+/) : [];
  const editingNewToken = endsWithSpace || tokens.length === 0;
  const completed = editingNewToken ? tokens : tokens.slice(0, -1);
  const current = editingNewToken ? "" : tokens[tokens.length - 1];

  let candidates: string[] = [];
  if (completed.length === 0) {
    candidates = TOP_LEVEL_COMMANDS;
  } else if (completed[0] === "mcp") {
    if (completed.length === 1) {
      candidates = ["list", "add"];
    } else if (completed.length === 2 && completed[1] === "add") {
      candidates = serverIds;
    }
  } else if (completed[0] === "cat" || completed[0] === "read_file") {
    if (completed.length === 1) {
      candidates = files;
    }
  }

  const matches = candidates.filter((candidate) => candidate.startsWith(current));
  if (matches.length === 0) {
    return null;
  }

  const completedToken = longestCommonPrefix(matches);
  const newTokens = [...completed, completedToken];
  const value = newTokens.join(" ") + (matches.length === 1 ? " " : "");
  return { value, matches };
}

/**
 * Macht die bekannten Command-Ergebnisse menschenlesbar (statt Roh-JSON):
 * Dateiinhalt (cat/read_file), Dateiliste (ls), MCP-Server samt verfügbarer
 * Tools (mcp list) bzw. die Aktivierungs-Meldung (mcp add). Liefert `null`,
 * wenn es nichts Sinnvolles anzuzeigen gibt.
 */
function describeResultOutput(output: unknown): string | null {
  if (output === null || output === undefined) {
    return null;
  }
  if (typeof output === "string") {
    return output;
  }
  if (typeof output !== "object") {
    return String(output);
  }

  const value = output as Record<string, unknown>;

  // cat / read_file: Dateiinhalt direkt.
  if (typeof value.content === "string") {
    return value.content.length > 0 ? value.content : "(leer)";
  }

  // ls: Dateiliste.
  if (Array.isArray(value.files)) {
    return (value.files as string[]).join("\n");
  }

  // mcp list: Server plus aktuell verfügbare Tools.
  if (Array.isArray(value.servers)) {
    const servers = (value.servers as Array<{ id: string; label: string; active: boolean }>).map(
      (server) => `${server.active ? "●" : "○"} ${server.id} — ${server.label}`
    );
    const tools = value.available_tools as
      | Array<{ toolKey: string; description?: string }>
      | undefined;
    const toolLines =
      tools && tools.length > 0
        ? tools.map(
            (tool) => `  ${tool.toolKey}${tool.description ? ` — ${tool.description}` : ""}`
          )
        : ["  (keine — Server mit „mcp add <server>“ aktivieren)"];
    return ["MCP-Server:", ...servers, "", "Verfügbare Tools:", ...toolLines].join("\n");
  }

  // mcp add: Zusammenfassung bzw. Hinweis.
  if (typeof value.summary === "string") {
    return value.summary;
  }
  if (typeof value.message === "string") {
    return value.message;
  }

  return null;
}

/**
 * Ein Eintrag des Terminal-Scrollbacks: entweder ein Lageereignis aus dem
 * opsFeed oder ein ausgeführter Konsolen-Command. Beide Quellen werden nach
 * Tick gemischt (stabil, Lageereignis vor Command im selben Tick — der
 * Operator beobachtet erst, dann handelt er).
 */
type StreamItem =
  | { kind: "ops"; tick: number; order: number; line: OpsFeedLineView }
  | { kind: "cmd"; tick: number; order: number; entry: ConsoleCommandEntry };

function buildStream(
  opsLines: OpsFeedLineView[],
  entries: ConsoleCommandEntry[]
): StreamItem[] {
  const items: StreamItem[] = [
    ...opsLines.map<StreamItem>((line, order) => ({ kind: "ops", tick: line.tick, order, line })),
    ...entries.map<StreamItem>((entry, order) => ({
      kind: "cmd",
      tick: entry.tick,
      order,
      entry,
    })),
  ];

  return items.sort((a, b) => {
    if (a.tick !== b.tick) {
      return a.tick - b.tick;
    }
    if (a.kind !== b.kind) {
      return a.kind === "ops" ? -1 : 1;
    }
    return a.order - b.order;
  });
}

export function OperatorConsolePanel({
  commandText,
  onCommandTextChange,
  onExecute,
  entries,
  opsLines,
  mcpServerIds,
  workspaceFiles,
  disabled = false,
}: OperatorConsolePanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const stream = buildStream(opsLines, entries);

  // Command-History wie in einer echten Shell: alle ausgeführten Commands in
  // Eingabereihenfolge (neuester zuletzt). historyIndex === null bedeutet, dass
  // gerade die Live-Eingabe (nicht die History) angezeigt wird; `draft` merkt
  // sich dabei den aktuell getippten Text beim Eintauchen in die History.
  const history = entries.map((entry) => entry.command);
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const draftRef = useRef("");
  // Mehrdeutige Tab-Completion: Treffer als Hinweis unter der Eingabe.
  const [suggestions, setSuggestions] = useState<string[]>([]);

  // Wie ein echtes Terminal: bei neuem Inhalt ans Ende scrollen.
  useEffect(() => {
    const node = scrollRef.current;
    if (node) {
      node.scrollTop = node.scrollHeight;
    }
  }, [stream.length]);

  function setInput(value: string) {
    onCommandTextChange(value);
  }

  function handleChange(value: string) {
    // Manuelles Tippen verlässt die History und verwirft Completion-Hinweise.
    setHistoryIndex(null);
    setSuggestions([]);
    setInput(value);
  }

  function navigateHistory(direction: "up" | "down") {
    if (history.length === 0) {
      return;
    }

    if (direction === "up") {
      if (historyIndex === null) {
        draftRef.current = commandText;
        const nextIndex = history.length - 1;
        setHistoryIndex(nextIndex);
        setInput(history[nextIndex]);
        return;
      }
      const nextIndex = Math.max(0, historyIndex - 1);
      setHistoryIndex(nextIndex);
      setInput(history[nextIndex]);
      return;
    }

    // direction === "down"
    if (historyIndex === null) {
      return;
    }
    const nextIndex = historyIndex + 1;
    if (nextIndex >= history.length) {
      setHistoryIndex(null);
      setInput(draftRef.current);
      return;
    }
    setHistoryIndex(nextIndex);
    setInput(history[nextIndex]);
  }

  function handleTab() {
    const completion = computeCompletion(commandText, mcpServerIds, workspaceFiles);
    if (!completion) {
      setSuggestions([]);
      return;
    }
    if (completion.value !== commandText) {
      setHistoryIndex(null);
      setInput(completion.value);
    }
    // Mehrere Treffer: als Hinweis anzeigen; ein einzelner Treffer ist eindeutig.
    setSuggestions(completion.matches.length > 1 ? completion.matches : []);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      setHistoryIndex(null);
      setSuggestions([]);
      onExecute();
      return;
    }

    if (event.key === "Tab") {
      event.preventDefault();
      handleTab();
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      navigateHistory("up");
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      navigateHistory("down");
    }
  }

  return (
    <section className="console-panel">
      <h2>Operator-Konsole</h2>

      <div className="console-scrollback" ref={scrollRef}>
        {stream.length === 0 ? (
          <p className="muted console-empty">
            human-01@ops:~$ — „help“ zeigt die verfügbaren Befehle · TAB
            vervollständigt · ↑/↓ blättert durch den Verlauf.
          </p>
        ) : (
          stream.map((item) =>
            item.kind === "ops" ? (
              <div
                key={`ops-${item.line.id}`}
                className={`console-line console-ops ops-sector-${item.line.sector}`}
              >
                <span className="console-tick">[{item.line.tick}]</span>
                <span className={`ops-badge ops-severity-${item.line.severity}`}>
                  {severityBadgeLabel(item.line.severity)}
                </span>
                <span className="ops-summary">{item.line.summary}</span>
                {item.line.details ? (
                  <span className="ops-details">{item.line.details}</span>
                ) : null}
              </div>
            ) : (
              <ConsoleCommandBlock key={`cmd-${item.entry.id}`} entry={item.entry} />
            )
          )
        )}
      </div>

      {suggestions.length > 0 ? (
        <div className="console-suggestions">{suggestions.join("   ")}</div>
      ) : null}

      <div className="console-input-row">
        <span className="console-prompt">human-01@ops:~$</span>
        <input
          className="console-input"
          value={commandText}
          onChange={(event) => handleChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Command eingeben und mit ENTER ausführen"
          spellCheck={false}
          disabled={disabled}
          autoFocus
        />
      </div>
    </section>
  );
}

/** Echo-Zeile (Prompt + Command) plus Ausgabe bzw. Fehlermeldung. */
function ConsoleCommandBlock({ entry }: { entry: ConsoleCommandEntry }) {
  const output = describeResultOutput(entry.output);

  return (
    <div className="console-command">
      <div className="console-line console-echo">
        <span className="console-prompt">human-01@ops:~$</span>
        <span className="console-command-text">{entry.command}</span>
      </div>
      {entry.success ? (
        output ? (
          <pre className="console-output">{output}</pre>
        ) : null
      ) : (
        <pre className="console-output console-error-output">
          {entry.error ?? "Fehler"}
        </pre>
      )}
    </div>
  );
}
