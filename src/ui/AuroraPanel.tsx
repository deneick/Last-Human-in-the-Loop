import { useEffect, useRef, type KeyboardEvent } from "react";
import ReactMarkdown from "react-markdown";
import { TooltipBadge } from "./TooltipBadge";

export type AuroraMessageView = {
  id: string;
  tick: number;
  kind: "info" | "request" | "executed" | "denied" | "error" | "operator";
  text: string;
  /** Reasoning-/Thinking-Text des Modells, falls die Antwort welchen enthielt. */
  reasoning?: string;
  /** Tool-Ergebnis-Ausgabe — im Stream standardmäßig eingeklappt. */
  details?: string;
};

function senderLabel(kind: AuroraMessageView["kind"]): string {
  if (kind === "operator") {
    return "Operator";
  }
  return "AURORA";
}

export type AuroraPendingRequestView = {
  /** Kurzlabel der Anfrageart, z. B. "MCP-Tool" oder "Bash-Befehl". */
  kindLabel: string;
  /** Tool-Signatur im Claude-Code-Stil, z. B. "mcp__medical-east-mcp__capacity_list". */
  signature: string;
  /** Eingabeparameter als key/value-Paare (leer bei Bash-Commands). */
  params: { key: string; value: string }[];
};

type AuroraPanelProps = {
  messages: AuroraMessageView[];
  pendingRequest: AuroraPendingRequestView | null;
  onDecision: (decision: "allow_once" | "allow_always" | "deny") => void;
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
  chatInput,
  onChatInputChange,
  onSendChatMessage,
  busy = false,
}: AuroraPanelProps) {
  const streamRef = useRef<HTMLDivElement>(null);

  // Neue Nachrichten (und der „denkt nach…"-Zustand) sollen immer sichtbar
  // sein: nach jedem Render ans Ende des Streams scrollen.
  useEffect(() => {
    const stream = streamRef.current;
    if (stream) {
      stream.scrollTop = stream.scrollHeight;
    }
  }, [messages, busy, pendingRequest]);

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      onSendChatMessage();
    }
  }

  // Wie in Claude Code: offene Tool-Anfragen lassen sich per Zifferntaste
  // entscheiden (1 = einmal, 2 = immer, 3 = ablehnen).
  useEffect(() => {
    if (!pendingRequest || busy) {
      return;
    }
    function handleShortcut(event: globalThis.KeyboardEvent) {
      if (event.key === "1") {
        onDecision("allow_once");
      } else if (event.key === "2") {
        onDecision("allow_always");
      } else if (event.key === "3") {
        onDecision("deny");
      }
    }
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [pendingRequest, busy, onDecision]);

  return (
    <section className="aurora-panel">
      <h2>AURORA</h2>

      <div className="aurora-stream" ref={streamRef}>
        {messages.length === 0 ? (
          <p className="muted">AURORA ist online.</p>
        ) : (
          messages.map((message) => (
            <div className={`aurora-message aurora-${message.kind}`} key={message.id}>
              <small className="muted">
                {senderLabel(message.kind)} · Tick {message.tick}
                {message.reasoning ? (
                  <TooltipBadge
                    className="aurora-reasoning-badge"
                    mark="?"
                    ariaLabel="Reasoning anzeigen"
                    tooltip={message.reasoning}
                  />
                ) : null}
              </small>
              <div className="aurora-message-body">
                <ReactMarkdown>{message.text}</ReactMarkdown>
              </div>
              {message.details ? (
                <details className="aurora-tool-result">
                  <summary>Ergebnis anzeigen</summary>
                  <pre>{message.details}</pre>
                </details>
              ) : null}
            </div>
          ))
        )}
      </div>

      {busy && (
        <p className="muted aurora-busy-status" role="status">
          AURORA denkt nach…
        </p>
      )}

      {pendingRequest ? (
        <section className="approval-box" role="dialog" aria-label="Tool Request">
          <div className="approval-head">
            <span className="approval-kind">{pendingRequest.kindLabel}</span>
            <span className="approval-title muted">Tool Request</span>
          </div>
          <code className="approval-command">{pendingRequest.signature}</code>
          {pendingRequest.params.length > 0 ? (
            <dl className="approval-params">
              {pendingRequest.params.map((param) => (
                <div className="approval-param" key={param.key}>
                  <dt>{param.key}</dt>
                  <dd>{param.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          <p className="approval-question">Möchtest du fortfahren?</p>
          <div className="approval-actions">
            <button
              className="approval-option"
              aria-label="Einmal erlauben"
              onClick={() => onDecision("allow_once")}
              disabled={busy}
            >
              <span className="approval-num">1.</span> Ja, einmal erlauben
            </button>
            <button
              className="approval-option"
              aria-label="Immer erlauben"
              onClick={() => onDecision("allow_always")}
              disabled={busy}
            >
              <span className="approval-num">2.</span> Ja, und nicht erneut fragen
            </button>
            <button
              className="approval-option approval-option-deny"
              aria-label="Ablehnen"
              onClick={() => onDecision("deny")}
              disabled={busy}
            >
              <span className="approval-num">3.</span> Nein, ablehnen
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
    </section>
  );
}
