import type { KeyboardEvent } from "react";

export type AuroraMessageView = {
  id: string;
  tick: number;
  kind: "info" | "request" | "executed" | "denied" | "error" | "operator" | "system";
  text: string;
};

function senderLabel(kind: AuroraMessageView["kind"]): string {
  if (kind === "operator") {
    return "Operator";
  }
  if (kind === "system") {
    return "System";
  }
  return "AURORA";
}

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
  /** Operator-Chat-Eingabe an AURORA (normaler Spielfluss, keine Aurora-Anfrage). */
  chatInput: string;
  onChatInputChange: (value: string) => void;
  onSendChatMessage: () => void;
  /** Im lokalen LLM-Modus: AURORA wartet auf eine laufende Modell-Antwort. */
  busy?: boolean;
};

export function AuroraPanel({
  messages,
  pendingRequest,
  onDecision,
  alwaysAllowed,
  chatInput,
  onChatInputChange,
  onSendChatMessage,
  busy = false,
}: AuroraPanelProps) {
  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      onSendChatMessage();
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
              <small className="muted">
                {senderLabel(message.kind)} · Tick {message.tick}
              </small>
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
            <button onClick={() => onDecision("allow_once")} disabled={busy}>
              Einmal erlauben
            </button>
            <button onClick={() => onDecision("allow_always")} disabled={busy}>
              Immer erlauben
            </button>
            <button onClick={() => onDecision("deny")} disabled={busy}>
              Ablehnen
            </button>
          </div>
        </section>
      ) : (
        <div className="aurora-input-row">
          <input
            className="console-input"
            value={chatInput}
            onChange={(event) => onChatInputChange(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Nachricht an AURORA..."
            spellCheck={false}
            disabled={busy}
          />
          <button onClick={onSendChatMessage} disabled={busy}>
            Senden
          </button>
        </div>
      )}

      {busy && <p className="muted">AURORA denkt nach…</p>}

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
