import type { KeyboardEvent } from "react";
import type { CommandResult } from "../runtime/commands";
import type { AuditLogLineView } from "./viewModel";

type OperatorConsolePanelProps = {
  commandText: string;
  onCommandTextChange: (value: string) => void;
  onExecute: () => void;
  commandNames: string[];
  examples: string[];
  lastResult: CommandResult | null;
  auditLines: AuditLogLineView[];
};

function getResultLabel(result: CommandResult | null) {
  if (!result) {
    return "Noch kein Command ausgeführt.";
  }

  if (result.success) {
    return `OK: ${result.command.raw}`;
  }

  return `FEHLER: ${result.error ?? result.command.raw}`;
}

export function OperatorConsolePanel({
  commandText,
  onCommandTextChange,
  onExecute,
  commandNames,
  examples,
  lastResult,
  auditLines,
}: OperatorConsolePanelProps) {
  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      onExecute();
    }
  }

  return (
    <section className="console-panel">
      <h2>Operator Console</h2>
      <div className="console-input-row">
        <span className="console-prompt">human-01@ops:~$</span>
        <input
          className="console-input"
          value={commandText}
          onChange={(event) => onCommandTextChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Command eingeben und mit ENTER ausführen"
          spellCheck={false}
        />
        <button onClick={onExecute}>Ausführen</button>
      </div>

      <details className="command-reference">
        <summary>Verfügbare Commands ({commandNames.length})</summary>
        <ul>
          {commandNames.map((name) => (
            <li key={name}>
              <code>{name}</code>
            </li>
          ))}
        </ul>
        <p className="muted">Beispiele (klicken zum Übernehmen):</p>
        <div className="examples">
          {examples.map((command) => (
            <button key={command} onClick={() => onCommandTextChange(command)}>
              {command}
            </button>
          ))}
        </div>
      </details>

      <h3>Letztes Result</h3>
      <p className={lastResult?.success === false ? "error-text" : "ok-text"}>
        {getResultLabel(lastResult)}
      </p>
      <pre className="result-output">
        {lastResult ? JSON.stringify(lastResult.output, null, 2) : "—"}
      </pre>

      <h3>Runtime Log</h3>
      {auditLines.length === 0 ? (
        <p className="muted">Noch keine Ereignisse.</p>
      ) : (
        <ol className="runtime-log">
          {auditLines.slice(-30).map((line) => (
            <li key={line.id} className="runtime-log-line">
              <span className="log-tick">[{line.tick}]</span>
              <span className={`log-source log-source-${line.source}`}>{line.source}</span>
              <span className={line.success ? "ok-text" : "error-text"}>{line.text}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
