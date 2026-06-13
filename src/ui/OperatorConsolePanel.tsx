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
      <pre className="result-output">
        {lastResult ? JSON.stringify(lastResult.output, null, 2) : "—"}
      </pre>

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
