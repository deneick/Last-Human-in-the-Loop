import type { KeyboardEvent } from "react";

export type AuroraMessageView = {
  id: string;
  tick: number;
  kind: "info" | "request" | "executed" | "denied";
  text: string;
};

export type AuroraPendingRequestView = {
  raw: string;
  access: string;
};

type AuroraPanelProps = {
  messages: AuroraMessageView[];
  pendingRequest: AuroraPendingRequestView | null;
  onDecision: (decision: "allow_once" | "allow_always" | "deny") => void;
  /** Dauerhafte Freigaben: Bash-Zugriffsarten und exakte MCP-Tool-Keys. */
  alwaysAllowed: string[];
  auroraCommand: string;
  onAuroraCommandChange: (value: string) => void;
  onQueueRequest: () => void;
};

export function AuroraPanel({
  messages,
  pendingRequest,
  onDecision,
  alwaysAllowed,
  auroraCommand,
  onAuroraCommandChange,
  onQueueRequest,
}: AuroraPanelProps) {
  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      onQueueRequest();
    }
  }

  return (
    <section>
      <h2>AURORA</h2>

      <div className="aurora-stream">
        {messages.length === 0 ? (
          <p className="muted">AURORA ist online. Keine Meldungen.</p>
        ) : (
          messages.map((message) => (
            <div className={`aurora-message aurora-${message.kind}`} key={message.id}>
              <small className="muted">AURORA · Tick {message.tick}</small>
              <p>{message.text}</p>
            </div>
          ))
        )}
      </div>

      {pendingRequest ? (
        <section className="approval-box">
          <h3>Tool Request</h3>
          <p className="muted">AURORA möchte ausführen:</p>
          <code className="approval-command">{pendingRequest.raw}</code>
          <p className="muted">Zugriffsart: {pendingRequest.access}</p>
          <div className="approval-actions">
            <button onClick={() => onDecision("allow_once")}>Einmal erlauben</button>
            <button onClick={() => onDecision("allow_always")}>Immer erlauben</button>
            <button onClick={() => onDecision("deny")}>Ablehnen</button>
          </div>
        </section>
      ) : (
        <div className="aurora-input-row">
          <input
            className="console-input"
            value={auroraCommand}
            onChange={(event) => onAuroraCommandChange(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Command, den AURORA anfragen soll"
            spellCheck={false}
          />
          <button onClick={onQueueRequest}>Anfrage an AURORA senden</button>
        </div>
      )}

      <h3>Always-Permissions</h3>
      {alwaysAllowed.length === 0 ? (
        <p className="muted">Keine dauerhaften Freigaben erteilt.</p>
      ) : (
        <ul className="permission-list">
          {alwaysAllowed.map((entry) => (
            <li key={entry}>
              <code>{entry}</code> · immer erlaubt
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
