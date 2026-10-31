import { ACTION_LABEL, type AuroraAction, type NodeKind, type GameState } from "../sim/types";

export const KIND_ICON: Record<NodeKind, string> = {
  CORE: "◎",
  DC: "▦",
  PWR: "⚡",
  NET: "≋",
  IAM: "⚿",
  MON: "◉",
  MNT: "⚙",
  SVC: "✚",
};

export function describeAction(action: AuroraAction, state: Pick<GameState, "nodes">): string {
  if (action.type === 0) return ACTION_LABEL[0];
  return `${ACTION_LABEL[action.type]}: ${state.nodes[action.node]?.name ?? "?"}`;
}
