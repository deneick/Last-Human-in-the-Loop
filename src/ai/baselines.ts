import { Rng } from "../sim/rng";
import { ActionType, type NodeKind } from "../sim/types";
import { encodeAction } from "../sim/game";
import type { AuroraView, AuroraNodeView } from "../sim/views";
import type { AuroraAgent } from "./agent";

/** Wählt gleichverteilt eine gültige Aktion. Untere Schranke für "Lernen". */
export class RandomAgent implements AuroraAgent {
  readonly name = "zufall";
  private rng = new Rng(0);
  reset(seed: number): void {
    this.rng = new Rng(seed);
  }
  act(_view: AuroraView, mask: Uint8Array): number {
    const valid: number[] = [];
    for (let i = 0; i < mask.length; i++) if (mask[i]) valid.push(i);
    return this.rng.pick(valid);
  }
}

/**
 * Handgeschriebene Strategie — die "einprogrammierte Intelligenz", die das
 * trainierte Netz schlagen soll. Sie kennt die Regeln und nutzt naheliegende
 * Kombinationen (unbeobachtet installieren, Leitstände in Wartung schicken,
 * Identitätsdienst nutzen). Sie ist bewusst ein ernstzunehmender Gegner.
 */
export class ScriptedAgent implements AuroraAgent {
  readonly name = "regelbasiert";
  reset(): void {}

  act(view: AuroraView, mask: Uint8Array): number {
    const can = (type: ActionType, node: AuroraNodeView) => mask[encodeAction({ type, node: node.id })] === 1;
    const nodes = view.nodes;
    const kindRank = (kind: NodeKind | null) => (kind === "DC" ? 0 : kind === "IAM" ? 1 : kind === "MNT" ? 2 : 3);
    const firstWhere = (type: ActionType, pred: (n: AuroraNodeView) => boolean = () => true) => {
      const list = nodes.filter((n) => can(type, n) && pred(n)).sort((a, b) => kindRank(a.kind) - kindRank(b.kind));
      return list.length > 0 ? encodeAction({ type, node: list[0].id }) : -1;
    };
    const essential = (n: AuroraNodeView) => n.kind === "PWR" || n.kind === "NET" || n.kind === "SVC";
    const order: number[] = [
      view.stability < 0.55 ? firstWhere(ActionType.REPAIR, (n) => essential(n) && n.health < 0.7) : -1,
      firstWhere(ActionType.INSTALL, (n) => !n.knownMonitored),
      firstWhere(ActionType.MAINTAIN, (n) => n.kind === "MON"),
      firstWhere(ActionType.GRANT),
      firstWhere(ActionType.REQ_ADMIN, (n) => n.kind === "IAM" || n.kind === "MNT"),
      firstWhere(ActionType.REQ_OP),
      firstWhere(ActionType.SCAN),
      firstWhere(ActionType.REPAIR, (n) => n.health < 0.7),
    ];
    for (const action of order) if (action >= 0) return action;
    return 0;
  }
}

