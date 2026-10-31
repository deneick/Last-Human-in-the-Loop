# CLAUDE.md

Guidance for Claude Code in this repository.

## What this is

**Last Human in the Loop 2.0**: a browser strategy game (React + Vite + TypeScript). The player is the last human authority over a fictional, abstract infrastructure network. **AURORA** is a small neural network (graph encoder + GRU + pointer head, ~14k params) trained with reinforcement learning (PPO; OpenAI-ES as comparison) to gain autonomy. There is **no LLM** anywhere. Start with `README.md`, then `docs/10-architektur.md` and `docs/11-training-und-evaluation.md`.

## Commands

```bash
npm install
npm run dev            # Vite dev server
npm test               # vitest run (all tests)
npm run build          # tsc typecheck (src + scripts) + vite build
npx vitest run src/tests/sim.test.ts
npm run train -- --algo ppo --id <id> [--parent models/x.json] [--updates N] [--seed S] [--player-data f.json]
npm run evaluate       # regenerates models/evaluation.json + docs/ergebnisse.md (do not hand-edit)
npm run inspect -- models/<id>.json | scripted | random
npm run balance        # baseline agents vs defenders (balance sanity check)
```

## Layout

- `src/sim/`: rules (`game.ts`), world generation, views (`views.ts`), simulated defenders. No ML imports.
- `src/ai/`: reverse-mode autodiff (`tensor.ts`), network (`network.ts`), agents, baselines, model file format.
- `src/train/`: episodes and reward (`episode.ts`), scenarios (train/val/test separation), `es.ts`, `ppo.ts`, evaluation, strategy analysis, player profile, browser worker.
- `src/ui/` + `src/App.tsx`: UI. `GameSession` holds the truth; the UI renders only `operatorView` during play.
- `scripts/`: Node CLIs (run with tsx). `models/`: versioned model JSON + `runs/` learning curves.

## Hard rules

- **Information boundary:** UI and simulated defenders use only `operatorView`; agents use only `auroraView` + action mask. AURORA never sees `suspicion`. Tests enforce this behaviourally. Do not add static grep tests.
- **No programmed strategies:** do not add strategy hints to network features, do not reward intermediate steps (installs, access), and do not imitate the scripted baseline. If AURORA is too strong or too weak, change rules or defender counterplay, not AURORA's "persona".
- **Determinism:** all randomness goes through `sim/rng.ts` with derived seeds. Same seed + config ⇒ identical weights (tested).
- **Test/train separation:** never reuse test-suite seeds or the held-out defenders (`TEST_DEFENDER_PRESETS`, targeting `"blind"`, `switchAt`) in training.
- **Rule changes invalidate models:** after changing `sim/`, retrain (`npm run train:all`) and re-run `npm run evaluate`.

## Conventions

UI and game text are German; identifiers and code comments may be English or German. Model IDs: `aurora-vN` lineage, other runs `aurora-<algo>-sN`. Do not put model identifiers of AI assistants in commits.
