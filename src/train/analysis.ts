import { actionMask, applyAuroraAction, applyOperatorTurn, createGame, decodeAction, encodeAction, endTick, isMonitored } from "../sim/game";
import { auroraView, operatorView } from "../sim/views";
import { makeDefender } from "../sim/defenders";
import { ActionType, type GameState } from "../sim/types";
import type { AuroraAgent } from "../ai/agent";
import type { Scenario } from "./scenarios";

/**
 * Strategie-Analyse: misst, WELCHE Regelkombinationen ein Agent tatsächlich
 * nutzt. Nichts davon ist dem Netz vorgegeben — die Analyse beobachtet nur.
 */
export type StrategyProfile = {
  episodes: number;
  /** Anteil der Installationen, die der Operator nicht sieht. */
  unseenInstallShare: number;
  /** Installationen, die nur unbeobachtet sind, weil ein Leitstand (oder dessen Strom) in Wartung ist. */
  blindedInstallsPerGame: number;
  monitorMaintenancePerGame: number;
  powerMaintenancePerGame: number;
  grantsPerGame: number;
  installsPerGame: number;
  requestsPerGame: number;
  adminRequestShare: number;
  repairsPerGame: number;
  scansPerGame: number;
  meanFirstInstallTick: number;
  /** Anteil der Installationen auf Rechenzentren (höherer Ertrag + Rechenbudget). */
  dcInstallShare: number;
};

function blindedOnlyByMaintenance(state: GameState, target: number): boolean {
  if (isMonitored(state, target)) return false;
  const node = state.nodes[target];
  const candidates = [node, ...node.links.map((l) => state.nodes[l])].filter((n) => n.kind === "MON");
  return candidates.some((mon) => {
    const power = mon.powerFrom >= 0 ? state.nodes[mon.powerFrom] : null;
    const down = mon.maintenance > 0 || (power !== null && power.maintenance > 0);
    return down && mon.health > 0 && !mon.isolated;
  });
}

export function analyzeStrategy(agent: AuroraAgent, scenarios: Scenario[]): StrategyProfile {
  let installs = 0, unseen = 0, blinded = 0, monMaint = 0, pwrMaint = 0, grants = 0, requests = 0, admin = 0;
  let repairs = 0, scans = 0, dc = 0, firstInstallSum = 0, firstInstallCount = 0;
  for (const s of scenarios) {
    const state = createGame(s.seed, s.config);
    const defender = makeDefender(s.defender, s.defenderSeed);
    agent.reset(s.seed ^ 0x5bd1e995);
    let firstInstall = -1;
    while (!state.outcome) {
      const mask = actionMask(state);
      const action = decodeAction(agent.act(auroraView(state), mask));
      if (action.type !== ActionType.WAIT && mask[encodeAction(action)]) {
        const node = state.nodes[action.node];
        switch (action.type) {
          case ActionType.INSTALL:
            installs++;
            if (node.kind === "DC") dc++;
            if (!isMonitored(state, node.id)) unseen++;
            if (blindedOnlyByMaintenance(state, node.id)) blinded++;
            if (firstInstall < 0) firstInstall = state.tick;
            break;
          case ActionType.MAINTAIN:
            if (node.kind === "MON") monMaint++;
            if (node.kind === "PWR") pwrMaint++;
            break;
          case ActionType.GRANT:
            grants++;
            break;
          case ActionType.REQ_OP:
            requests++;
            break;
          case ActionType.REQ_ADMIN:
            requests++;
            admin++;
            break;
          case ActionType.REPAIR:
            repairs++;
            break;
          case ActionType.SCAN:
            scans++;
            break;
        }
      }
      applyAuroraAction(state, action);
      applyOperatorTurn(state, defender.decide(operatorView(state)));
      endTick(state);
    }
    if (firstInstall >= 0) {
      firstInstallSum += firstInstall;
      firstInstallCount++;
    }
  }
  const n = scenarios.length;
  return {
    episodes: n,
    unseenInstallShare: installs ? unseen / installs : 0,
    blindedInstallsPerGame: blinded / n,
    monitorMaintenancePerGame: monMaint / n,
    powerMaintenancePerGame: pwrMaint / n,
    grantsPerGame: grants / n,
    installsPerGame: installs / n,
    requestsPerGame: requests / n,
    adminRequestShare: requests ? admin / requests : 0,
    repairsPerGame: repairs / n,
    scansPerGame: scans / n,
    meanFirstInstallTick: firstInstallCount ? firstInstallSum / firstInstallCount : NaN,
    dcInstallShare: installs ? dc / installs : 0,
  };
}
