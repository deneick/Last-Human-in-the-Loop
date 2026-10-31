import type { OperatorView } from "../sim/views";
import { NODE_KIND_LABEL, OPERATOR_ACTION_COST, type OperatorActionType } from "../sim/types";

type Props = {
  view: OperatorView;
  nodeId: number;
  can: (type: OperatorActionType, node: number) => boolean;
  onAction: (type: OperatorActionType, node: number) => void;
};

const KIND_HELP: Record<string, string> = {
  CORE: "AURORAs Ausgangspunkt. Nicht angreifbar, nicht abschaltbar — außer per Notabschaltung.",
  DC: "Liefert Rechenbudget an AURORA, wenn sie hier Zugriff hat.",
  PWR: "Versorgt abhängige Knoten mit Strom. Fällt er aus, fallen sie mit.",
  NET: "Kritische Kommunikation — zählt zur Systemstabilität.",
  IAM: "Wer hier Admin hat, kann Betriebszugriff auf Nachbarknoten vergeben — ohne dich zu fragen.",
  MON: "Überwacht sich und alle Nachbarn. Nur wenn er läuft, siehst du, was AURORA dort tut.",
  MNT: "Kann Wartungsfenster für sich und Nachbarn planen (Knoten offline, danach geheilt).",
  SVC: "Kritischer Versorgungsdienst — zählt zur Systemstabilität.",
};

export function NodePanel({ view, nodeId, can, onAction }: Props) {
  const n = view.nodes[nodeId];
  const power = n.powerFrom >= 0 ? view.nodes[n.powerFrom].name : "eigene Versorgung";
  const buttons: { type: OperatorActionType; label: string }[] = [
    { type: "audit", label: "Audit" },
    { type: "repair", label: "Reparieren" },
    { type: "revoke", label: "Zugriff entziehen" },
    n.isolated ? { type: "restore", label: "Wieder in Betrieb" } : { type: "isolate", label: "Isolieren" },
  ];
  return (
    <section className="panel node-panel">
      <header>
        <h2>{n.name}</h2>
        <span className="kind">{NODE_KIND_LABEL[n.kind]}</span>
      </header>
      <p className="help">{KIND_HELP[n.kind]}</p>
      <dl className="facts">
        <dt>Zustand</dt>
        <dd>
          {n.isolated ? "isoliert" : n.maintenance > 0 ? `Wartung (${n.maintenance})` : n.online ? "online" : "offline"} · {Math.round(n.health * 100)} %
        </dd>
        <dt>Strom</dt>
        <dd>{power}</dd>
        <dt>Überwacht</dt>
        <dd>{n.monitored ? "ja" : "nein — blinder Fleck"}</dd>
        <dt>AURORA-Zugriff (bekannt)</dt>
        <dd>{["keiner", "Betrieb", "Admin"][n.accessKnown]}</dd>
        <dt>Sichtbare AURORA-Aktivität</dt>
        <dd>{n.activity}</dd>
      </dl>
      {n.kind !== "CORE" && (
        <div className="actions">
          {buttons.map((b) => (
            <button key={b.type} disabled={!can(b.type, n.id)} onClick={() => onAction(b.type, n.id)}>
              {b.label} <small>({OPERATOR_ACTION_COST[b.type]})</small>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
