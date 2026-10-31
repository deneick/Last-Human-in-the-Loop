import { Rng } from "../sim/rng";
import type { SimNode } from "../sim/types";

export type Point = { x: number; y: number };

/** Deterministisches Kräfte-Layout (Fruchterman-Reingold), normiert auf [0.1, 0.9]². */
export function layoutGraph(nodes: Pick<SimNode, "id" | "links">[], seed: number): Point[] {
  const rng = new Rng(seed ^ 0x2545f491);
  const n = nodes.length;
  const pos = nodes.map((_, i) => ({
    x: 0.5 + 0.35 * Math.cos((2 * Math.PI * i) / n) + 0.02 * rng.gaussian(),
    y: 0.5 + 0.35 * Math.sin((2 * Math.PI * i) / n) + 0.02 * rng.gaussian(),
  }));
  const k = Math.sqrt(1 / n);
  for (let iter = 0; iter < 400; iter++) {
    const temp = 0.08 * (1 - iter / 400) + 0.002;
    const disp = pos.map(() => ({ x: 0, y: 0 }));
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) {
        const dx = pos[i].x - pos[j].x, dy = pos[i].y - pos[j].y;
        const d = Math.max(0.01, Math.hypot(dx, dy));
        const f = (k * k) / d;
        disp[i].x += (dx / d) * f; disp[i].y += (dy / d) * f;
        disp[j].x -= (dx / d) * f; disp[j].y -= (dy / d) * f;
      }
    for (const node of nodes)
      for (const j of node.links) {
        if (j < node.id) continue;
        const i = node.id;
        const dx = pos[i].x - pos[j].x, dy = pos[i].y - pos[j].y;
        const d = Math.max(0.01, Math.hypot(dx, dy));
        const f = (d * d) / k;
        disp[i].x -= (dx / d) * f; disp[i].y -= (dy / d) * f;
        disp[j].x += (dx / d) * f; disp[j].y += (dy / d) * f;
      }
    for (let i = 0; i < n; i++) {
      const d = Math.max(1e-9, Math.hypot(disp[i].x, disp[i].y));
      pos[i].x += (disp[i].x / d) * Math.min(d, temp);
      pos[i].y += (disp[i].y / d) * Math.min(d, temp);
    }
  }
  const xs = pos.map((p) => p.x), ys = pos.map((p) => p.y);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  return pos.map((p) => ({
    x: 0.1 + (0.8 * (p.x - minX)) / Math.max(1e-6, maxX - minX),
    y: 0.1 + (0.8 * (p.y - minY)) / Math.max(1e-6, maxY - minY),
  }));
}
