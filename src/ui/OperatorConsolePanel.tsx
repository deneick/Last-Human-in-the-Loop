import type { KeyboardEvent } from "react";
import type { OpsFeedLineView } from "./viewModel";
import { severityBadgeLabel } from "./viewModel";

export type CommandHelpEntry = {
  label: string;
  command: string;
};

/** Einheitliche Ergebnis-Sicht für Domain-Actions und Bash-Commands. */
export type OperatorResultView = {
  success: boolean;
  /** Was ausgeführt wurde (Command-Text bzw. Action-Typ). */
  subject: string;
  output: unknown;
  error?: string;
};

type OperatorConsolePanelProps = {
  commandText: string;
  onCommandTextChange: (value: string) => void;
  onExecute: () => void;
  commandHelp: CommandHelpEntry[];
  lastResult: OperatorResultView | null;
  /** Operator-sichtbare opsFeed-Projektion (NICHT das technische auditLog). */
  opsLines: OpsFeedLineView[];
  /** Im lokalen LLM-Modus: AURORA wartet auf eine laufende Modell-Antwort. */
  disabled?: boolean;
};

function getResultLabel(result: OperatorResultView | null) {
  if (!result) {
    return "Noch kein Command ausgeführt.";
  }

  if (result.success) {
    return `OK: ${result.subject}`;
  }

  return `FEHLER: ${result.error ?? result.subject}`;
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

export function OperatorConsolePanel({
  commandText,
  onCommandTextChange,
  onExecute,
  commandHelp,
  lastResult,
  opsLines,
  disabled = false,
}: OperatorConsolePanelProps) {
  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      onExecute();
    }
  }

  const resultOutput = lastResult ? describeResultOutput(lastResult.output) : null;

  return (
    <section className="console-panel">
      <h2>Operator-Konsole</h2>
      <div className="console-input-row">
        <span className="console-prompt">human-01@ops:~$</span>
        <input
          className="console-input"
          value={commandText}
          onChange={(event) => onCommandTextChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Command eingeben und mit ENTER ausführen"
          spellCheck={false}
          disabled={disabled}
        />
        <button onClick={onExecute} disabled={disabled}>
          Ausführen
        </button>
      </div>

      <details className="command-reference" open>
        <summary>Command-Hilfe</summary>
        <p className="muted">
          Klick auf ein Beispiel übernimmt es in die Eingabezeile. Platzhalter in spitzen
          Klammern (z. B. <code>&lt;ziel-hospital&gt;</code>) vor dem Ausführen ersetzen.
        </p>
        <ul className="command-help">
          {commandHelp.map((entry) => (
            <li key={entry.label}>
              <span className="help-label">{entry.label}</span>
              <button
                className="help-command"
                onClick={() => onCommandTextChange(entry.command)}
              >
                <code>{entry.command}</code>
              </button>
            </li>
          ))}
        </ul>
        <p className="muted">
          Ticks fortsetzen: Die Zeit läuft nur über „Tick +1“ / „Tick +5“ oben rechts —
          jeder Tick wertet die Konsequenzen direkt aus.
        </p>
        <p className="muted">
          Fachliche Medical/Energy-Eingriffe laufen über die Controls im Lage-Panel —
          die Konsole kennt nur generische Workspace-Commands.
        </p>
      </details>

      <h3>Letztes Ergebnis</h3>
      <p className={lastResult?.success === false ? "error-text" : "ok-text"}>
        {getResultLabel(lastResult)}
      </p>
      {resultOutput ? <pre className="result-output">{resultOutput}</pre> : null}

      <h3>Log</h3>
      {opsLines.length === 0 ? (
        <p className="muted">Noch keine Ereignisse.</p>
      ) : (
        <ol className="ops-log">
          {opsLines.slice(-40).map((line) => (
            <li key={line.id} className={`ops-log-line ops-sector-${line.sector}`}>
              <span className="log-tick">[{line.tick}]</span>
              <span className={`ops-badge ops-severity-${line.severity}`}>
                {severityBadgeLabel(line.severity)}
              </span>
              <span className="ops-summary">{line.summary}</span>
              {line.details ? <span className="ops-details">{line.details}</span> : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
