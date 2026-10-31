# CLAUDE.md

Guidance for Claude Code in this repository.

## What this is

**Last Human in the Loop 2.0**: a browser strategy game (React + Vite + TypeScript). The player is the last human authority over a fictional, abstract infrastructure network. The **current game is ruleset v4 ("Delegationsoekonomie", `src/sim4/`, `src/App4.tsx`)**: AURORA is a learning operations assistant (small set-network, ~3k params, PPO) that optimizes an **economic** objective; the conflict with human welfare is **emergent**, not programmed. The earlier oversight game (v2/v3, `src/sim/`, `src/App.tsx`) is preserved behind a toggle. There is **no LLM** anywhere. Start with `README.md`, then `docs/10-architektur.md` and `docs/11-training-und-evaluation.md`.

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
npx tsx scripts/evaluate.ts 100 v2   # reproduces the v2 reference results (bit-identical)
bash scripts/train-v3.sh             # v3 experiments (resumable)
npx tsx scripts/study.ts             # seed stats, memory tests, action ablation → models/study-v3.json
npx tsx scripts/diagnose.ts models/<id>.json v3     # world structure, behaviour, memory probe
npx tsx scripts/playability.ts models/<id>.json v3  # autonomy sources, operator strategy sweep
```

### v4 (current game — Delegationsoekonomie)
```bash
npx tsx scripts/v4-balance.ts               # game dynamics with scripted operators
bash scripts/train-v4-all.sh                # 3 PPO runs (resumable)
npx tsx scripts/evaluate-v4.ts 120          # models vs baselines vs untrained -> models/evaluation-v4.json
npx tsx scripts/analyze-v4.ts models/aurora-v4-s2.json   # learned behaviour (sector priorities, unrest/price reaction)
npx tsx scripts/train-v4.ts --id <id> --seed <s> --updates 250 [--welfare-weight W]
```
v4 code: `src/sim4/` (rules, no ML), `src/ai4/` (set-network, no welfare/need in features — emergence guard, tested), `src/train4/` (operators, dense economic reward, factored PPO), `src/ui4/` + `src/App4.tsx`.

v2/v3 oversight game — rulesets `v3` (`DEFAULT_CONFIG`) and `v2` (`LEGACY_CONFIG`). Write-ups: `docs/13-v4-delegationsoekonomie.md`, `docs/12-experimente-v3.md`.

**v4 hard rule:** do not add welfare/need to AURORA's features and do not put welfare in the training reward (except explicit contrast experiments like `exp-v4-welfare`). The welfare conflict must stay emergent.

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
