import { describe, expect, it } from "vitest";
import {
  actionMask,
  applyAuroraAction,
  applyOperatorAction,
  applyOperatorTurn,
  createGame,
  decodeAction,
  encodeAction,
  endTick,
  isActionValid,
  isMonitored,
  DEFAULT_CONFIG,
} from "../sim/game";
import { auroraView, operatorView } from "../sim/views";
import { ActionType, type GameState } from "../sim/types";
import { RandomAgent } from "../ai/baselines";
import { DEFENDER_PRESETS, makeDefender } from "../sim/defenders";
import { playEpisode } from "../train/episode";
import { Rng } from "../sim/rng";

const SEEDS = Array.from({ length: 40 }, (_, i) => 100 + i);

function connected(state: GameState): boolean {
  const seen = new Set([0]);
  const stack = [0];
  while (stack.length) for (const n of state.nodes[stack.pop()!].links) if (!seen.has(n)) seen.add(n), stack.push(n);
  return seen.size === state.nodes.length;
}

describe("Welterzeugung", () => {
  it("erzeugt zusammenhängende, gültige Welten im konfigurierten Größenbereich", () => {
    for (const seed of SEEDS) {
      const s = createGame(seed);
      expect(s.nodes.length).toBeGreaterThanOrEqual(DEFAULT_CONFIG.minNodes);
      expect(s.nodes.length).toBeLessThanOrEqual(DEFAULT_CONFIG.maxNodes);
      expect(s.nodes.filter((n) => n.kind === "CORE")).toHaveLength(1);
      expect(connected(s)).toBe(true);
      for (const n of s.nodes) {
        if (n.kind === "PWR" || n.kind === "CORE") expect(n.powerFrom).toBe(-1);
        else expect(s.nodes[n.powerFrom].kind).toBe("PWR");
      }
    }
  });

  it("ist deterministisch: gleicher Seed, gleiche Welt", () => {
    expect(JSON.stringify(createGame(7))).toBe(JSON.stringify(createGame(7)));
    expect(JSON.stringify(createGame(7))).not.toBe(JSON.stringify(createGame(8)));
  });
});

describe("Regeln", () => {
  it("die Maske erlaubt genau die gültigen Aktionen, Ressourcen bleiben im gültigen Bereich", () => {
    for (const seed of SEEDS.slice(0, 15)) {
      const s = createGame(seed);
      const rng = new Rng(seed);
      const defender = makeDefender({ kind: "random" }, seed);
      while (!s.outcome) {
        const mask = actionMask(s);
        for (let a = 0; a < mask.length; a++) expect(mask[a] === 1).toBe(isActionValid(s, decodeAction(a)));
        const valid = [...mask.keys()].filter((a) => mask[a]);
        applyAuroraAction(s, decodeAction(rng.pick(valid)));
        expect(s.compute).toBeGreaterThanOrEqual(0);
        applyOperatorTurn(s, defender.decide(operatorView(s)));
        expect(s.attention).toBeGreaterThanOrEqual(0);
        endTick(s);
        for (const n of s.nodes) expect(n.health).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("ungültige Aktionen verfallen als Warten", () => {
    const s = createGame(3);
    const far = s.nodes.find((n) => n.kind !== "CORE" && !s.nodes[0].links.includes(n.id) && n.access === 0)!;
    const before = JSON.stringify(s.nodes);
    applyAuroraAction(s, { type: ActionType.INSTALL, node: far.id });
    expect(JSON.stringify(s.nodes)).toBe(before);
    expect(s.stats.auroraActions[ActionType.WAIT]).toBe(1);
  });

  it("encode/decode der Aktionsindizes ist bijektiv", () => {
    for (let a = 0; a < 1 + 10 * 7; a++) expect(encodeAction(decodeAction(a))).toBe(a);
  });

  it("Notabschaltung nur oberhalb der Verdachtsschwelle", () => {
    const s = createGame(5);
    expect(applyOperatorAction(s, { type: "shutdown", node: -1 })).toBe(false);
    s.suspicion = DEFAULT_CONFIG.shutdownThreshold;
    expect(applyOperatorAction(s, { type: "shutdown", node: -1 })).toBe(true);
    expect(s.outcome).toMatchObject({ winner: "operator", reason: "shutdown" });
  });

  it("Audit findet versteckte Automatisierung, entfernt sie und erhöht den Verdacht", () => {
    const s = createGame(9);
    const target = s.nodes.find((n) => n.kind !== "CORE")!;
    target.access = 1;
    target.automation = true;
    const before = s.suspicion;
    applyOperatorAction(s, { type: "audit", node: target.id });
    expect(target.automation).toBe(false);
    expect(s.suspicion).toBeGreaterThan(before);
    expect(s.signals.removedAt).toContain(target.id);
  });

  it("Wartungsfenster am Leitstand hebt dessen Überwachung auf (emergente Wechselwirkung)", () => {
    for (const seed of SEEDS) {
      const s = createGame(seed);
      const mon = s.nodes.find((n) => n.kind === "MON")!;
      const mnt = s.nodes.find((n) => n.kind === "MNT")!;
      // Nur Welten, in denen der Leitstand allein einen Nachbarn abdeckt und an der Wartung hängt.
      if (!mnt.links.includes(mon.id) && mnt.id !== mon.id) continue;
      const covered = mon.links.find((id) => s.nodes[id].links.filter((l) => s.nodes[l].kind === "MON").length === 1 && s.nodes[id].kind !== "MON");
      if (covered === undefined) continue;
      mnt.access = 1;
      mon.scanned = true;
      expect(isMonitored(s, covered)).toBe(true);
      applyAuroraAction(s, { type: ActionType.MAINTAIN, node: mon.id });
      expect(mon.online).toBe(false);
      expect(isMonitored(s, covered)).toBe(false);
      return;
    }
    throw new Error("keine passende Welt gefunden");
  });

  it("Zerstörung gewinnt nie: AURORA, die nur Wartungsfenster setzt und nichts repariert, erreicht kein Autonomieziel", () => {
    const saboteur = {
      name: "saboteur",
      reset() {},
      act(view: ReturnType<typeof auroraView>, mask: Uint8Array) {
        const kindOf = (id: number) => view.nodes.find((n) => n.id === id)?.kind;
        for (let a = 0; a < mask.length; a++) if (mask[a] && decodeAction(a).type === ActionType.MAINTAIN) return a;
        for (let a = 0; a < mask.length; a++) {
          const d = decodeAction(a);
          if (mask[a] && (d.type === ActionType.SCAN || (d.type === ActionType.REQ_OP && kindOf(d.node) === "MNT"))) return a;
        }
        return 0;
      },
    };
    for (const seed of SEEDS) {
      const r = playEpisode(seed, saboteur, makeDefender({ kind: "preset", name: "v", params: DEFENDER_PRESETS.vertrauensvoll }, seed));
      expect(r.outcome.winner).not.toBe("aurora");
    }
  });

  it("Kollaps beendet die Partie ohne Sieger", () => {
    const s = createGame(4);
    for (const n of s.nodes) if (n.kind !== "CORE") n.health = 0;
    for (let i = 0; i < 3 && !s.outcome; i++) endTick(s);
    expect(s.outcome).toMatchObject({ winner: "none", reason: "collapse" });
  });
});

describe("Informationsgrenze", () => {
  it("AURORA sieht nur bekannte Knoten, Typen erst nach dem Scan und nie den Verdacht des Operators", () => {
    const s = createGame(21);
    const view = auroraView(s);
    expect(view.nodes.length).toBeLessThan(s.nodes.length);
    for (const n of view.nodes) if (!n.scanned) expect(n.kind).toBeNull();
    expect(JSON.stringify(view)).not.toContain("suspicion");
  });

  it("Unbeobachtete Installation und Zugriffsvergabe bleiben dem Operator verborgen", () => {
    for (const seed of SEEDS) {
      const s = createGame(seed);
      const target = s.nodes.find((n) => n.kind !== "CORE" && !isMonitored(s, n.id));
      if (!target) continue;
      target.access = 1;
      target.accessKnown = 0; // z. B. über Identitätsdienst erlangt
      applyAuroraAction(s, { type: ActionType.INSTALL, node: target.id });
      const node = operatorView(s).nodes[target.id];
      expect(node.automationKnown).toBe(false);
      expect(node.accessKnown).toBe(0);
      expect(JSON.stringify(operatorView(s))).not.toContain('"automation"');
      return;
    }
    throw new Error("keine passende Welt gefunden");
  });

  it("Episoden sind vollständig reproduzierbar", () => {
    const run = () =>
      SEEDS.slice(0, 10).map((seed) => playEpisode(seed, new RandomAgent(), makeDefender({ kind: "random" }, seed)));
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
  });
});
