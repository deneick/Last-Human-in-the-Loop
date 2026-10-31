import { describe, expect, it } from "vitest";
import { Tape, withTape } from "../ai/tensor";
import { Network } from "../ai/network";
import { createGame, actionMask } from "../sim/game";
import { auroraView } from "../sim/views";
import { Rng } from "../sim/rng";

describe("Autodiff", () => {
  it("Gradienten des Netzes (über zwei GRU-Schritte) stimmen mit finiten Differenzen überein", () => {
    const net = Network.random({ hidden: 8 }, 3);
    const state = createGame(11);
    const view = auroraView(state);
    const mask = actionMask(state);
    const weights = new Rng(5);
    const w = Array.from({ length: 200 }, () => weights.gaussian());

    // Skalare Testfunktion: gewichtete Summe von Logits + Value nach 2 Schritten.
    const loss = (): { value: number; tape: Tape } => {
      const tape = new Tape();
      const value = withTape(tape, () => {
        const a = net.step(view, mask, net.initialMemory());
        const b = net.step(view, mask, a.memory);
        let s = b.value.data[0] * 0.7;
        b.logits.grad = new Float64Array(b.logits.data.length);
        b.value.grad = new Float64Array([0.7]);
        for (let i = 0; i < b.logits.data.length; i++) {
          s += w[i % w.length] * b.logits.data[i];
          b.logits.grad[i] = w[i % w.length];
        }
        return s;
      });
      return { value, tape };
    };

    net.grad.fill(0);
    loss().tape.backward();
    const analytic = Float64Array.from(net.grad);

    const probe = new Rng(9);
    const eps = 1e-6;
    let checked = 0;
    for (let k = 0; k < 60; k++) {
      const i = probe.int(net.size);
      const orig = net.params[i];
      net.params[i] = orig + eps;
      const up = loss().value;
      net.params[i] = orig - eps;
      const down = loss().value;
      net.params[i] = orig;
      const numeric = (up - down) / (2 * eps);
      expect(Math.abs(numeric - analytic[i])).toBeLessThan(1e-5 + 1e-4 * Math.abs(numeric));
      checked++;
    }
    expect(checked).toBe(60);
  });
});
