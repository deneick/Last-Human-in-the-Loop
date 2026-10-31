import { useMemo } from "react";
import type { OperatorView } from "../sim/views";
import { NODE_KIND_LABEL } from "../sim/types";
import { layoutGraph } from "./layout";
import { KIND_ICON } from "./labels";

type Props = {
  view: OperatorView;
  seed: number;
  selected: number | null;
  onSelect: (id: number) => void;
};

/** Netzkarte: zeigt nur, was der Operator weiß (OperatorView). */
export function NetworkMap({ view, seed, selected, onSelect }: Props) {
  const pos = useMemo(() => layoutGraph(view.nodes, seed), [seed, view.nodes.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const W = 100, H = 70;
  const P = (i: number) => ({ x: pos[i].x * W, y: pos[i].y * H });
  const pendingNode = view.pending?.node;
  return (
    <svg className="map" viewBox={`0 -3 ${W} ${H + 9}`} role="img" aria-label="Netzkarte">
      {view.nodes.flatMap((n) =>
        n.links.filter((j) => j > n.id).map((j) => {
          const a = P(n.id), b = P(j);
          const live = n.online && view.nodes[j].online;
          return <line key={`${n.id}-${j}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={live ? "edge" : "edge edge-down"} />;
        }),
      )}
      {view.nodes.map((n) => {
        const { x, y } = P(n.id);
        const classes = [
          "node",
          `kind-${n.kind}`,
          n.online ? "" : "offline",
          n.maintenance > 0 ? "maint" : "",
          n.isolated ? "isolated" : "",
          `access-${n.accessKnown}`,
          selected === n.id ? "selected" : "",
          pendingNode === n.id ? "pending" : "",
        ].join(" ");
        return (
          <g
            key={n.id}
            className={classes}
            transform={`translate(${x} ${y})`}
            onClick={() => onSelect(n.id)}
            role="button"
            aria-label={`${n.name} (${NODE_KIND_LABEL[n.kind]})`}
          >
            {n.monitored && <circle r={6.2} className="halo" />}
            <circle r={4.4} className="body" />
            <text className="icon" y={1.5}>{KIND_ICON[n.kind]}</text>
            {n.kind !== "CORE" && (
              <rect x={-4} y={5.4} width={8} height={1.1} className="hp-bg" rx={0.5} />
            )}
            {n.kind !== "CORE" && (
              <rect x={-4} y={5.4} width={8 * n.health} height={1.1} className={n.health < 0.35 ? "hp low" : "hp"} rx={0.5} />
            )}
            {n.automationKnown && <circle cx={3.6} cy={-3.6} r={1.4} className="alert-dot" />}
            {n.accessKnown > 0 && n.kind !== "CORE" && (
              <text className="badge" x={-4.6} y={-3}>{n.accessKnown === 2 ? "A" : "B"}</text>
            )}
            <text className="label" y={9.4}>{n.name}</text>
          </g>
        );
      })}
    </svg>
  );
}
