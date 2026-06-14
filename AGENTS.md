# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## What this is

**Last Human in the Loop** is a browser-based operator/terminal game (React + Vite + TypeScript) about human control over AI in a critical-infrastructure world. The player is the last human approval authority; **AURORA** is a cold, optimizing AI that needs the player's permission for any action beyond its base rights. There are two playable rounds: **ME-7741** (medical routing) and **GRID-1182** (energy grid). Read `docs/` for the full design — start with `README.md`, then `docs/03-runtime-architecture.md` (engine) and `docs/07-aurora-llm.md` (LLM agent).

## Commands

```bash
npm install          # install dependencies
npm run dev          # Vite dev server (http://localhost:5173)
npm test             # full Vitest suite (vitest run)
npm run build        # tsc typecheck + Vite production build
```

Single test file / pattern (no dedicated script — call vitest directly):

```bash
npx vitest run src/tests/runtime/tickEngine.test.ts   # one file
npx vitest run -t "override"                            # by test name
npx vitest                                              # watch mode
```

There is no linter configured. `npm run build` runs `tsc` and is the typecheck gate. Tests use `jsdom` (configured in `vite.config.ts` via Vitest defaults / `src/tests/helpers/testEnv.ts`).

## Core architecture

The codebase is **sector-agnostic** (sectors: `medical`, `energy`) with a strict, test-enforced separation between internal simulation truth and what is visible to the player and to AURORA. Get this separation right — it is the spine of the whole project.

### Two AURORA implementations, one engine

AURORA exists in two interchangeable forms, switchable live in the UI. Both run on the **same** WorldState, tick engine, permission flow, and consequences — only the *generation* of messages and tool intents differs:

- **LLM agent** (`src/aurora/`) — the actual goal. A real LLM agent over a local Ollama server (`OllamaModelClient`, OpenAI-compatible `/v1/chat/completions`, tool-calling). Provider-neutral interface `AuroraModelClient`; cloud providers are deliberately not wired up. `runAuroraAgentStep` (`agent.ts`) is one agent turn.
- **Scenario director** (`src/scenarios/*/scenarioDirector.ts`) — deterministic default/fallback. Scripted events that react **only** to public state (incident status, deaths, active overrides/shedding plans, tick count).

### State and information flow (`src/runtime/`)

`GameRuntimeState` (`runtimeState.ts`) holds:
- `world: WorldState` — incl. `world.simulation` = **internal engine truth, never visible** (e.g. `routing_failures`, `deaths_recorded`, `stable_ticks`).
- `auroraContext: AuroraContextEvent[]` — append-only event log; the **only** model-visible history (operator_message / aurora_response / tool_result / system_event). It is the single source for `buildAuroraModelRequest`. Holds **only** model-visible content.
- `opsFeed: OpsEvent[]` — append-only, player-visible situation feed (the UI "Log"). Each event has a `sector`, `severity`, and explicit `visibility` (operator / auroraContext / workspace). `appendOpsEvent` fans out: a `visibility.auroraContext` event also mirrors one `system_event` into `auroraContext`; `visibility.workspace` events render into `logs/<sector>.log` (readable via `bash` `cat`, no permission needed).
- `auditLog` — technical debug log, **not** shown in normal UI.
- `permissions`, `auroraQueue`, `mcp`, `scenario`.

Key rule: situation signals reach AURORA **only** as `system_event` via the opsFeed projection — never by direct injection. The AuroraQueue is a pure execution queue, never a history source.

### Tick pipeline (`src/runtime/tickEngine.ts`, `outcomeEngine.ts`)

`tickWorld` = `advanceClock → tickMedicalDomain → tickEnergyDomain → applyCrossSectorEffects (no-op) → evaluateIncidents`. Each domain stage is a no-op when its domain is absent.

`evaluateOutcomes` is **not** part of `tickWorld` — the caller chains `advanceScenario(evaluateOutcomes(advanceTick(state)))` so consequences are computed before the director reacts. Everything is deterministic: no randomness, no real time. Time only advances via `Tick +1` / `Tick +5` in the UI.

`opsFeedSensors.ts` derives ops events **diff-based** (compare `previousWorld` vs `nextWorld`) — `deriveOpsEvents` is pure. Transition detection (not snapshots) prevents duplicate events.

### Actions, MCP, and permissions

- **Domain actions** (`src/domain/`) — typed, discriminated union over `type` (`medical.*`, `energy.*`), each `read` or `write`, dispatched through `DomainActionRegistry`. Handlers return an immutable `WorldStatePatch` (`runtime/patch.ts`), not direct mutation. There is **no free-text command parser** for domain actions.
- The **player** reaches write actions only via the GUI controls of the situation panels (`runtimeExecutor.executePlayerDomainAction`).
- **AURORA** reaches the same actions only via simulated **MCP servers** (`src/mcp/`, e.g. `medical-east-mcp`), each tool mapping one input to exactly one domain action via `buildAction`. Activation (`mcp add <server>`) only makes tools visible — it grants no execution rights.
- **Every** MCP tool call (even reads) goes through the permission flow (`runtime/permissions.ts`, `auroraQueue.ts`); the queue runs FIFO with one open request at a time. Decisions: `allow_once` / `allow_always` (persists the exact subject key, deliberately coarse-grained) / `deny`. Bash reads (`ls`, `cat`, `read_file`, `mcp list`) run free; only `mcp add` needs approval.
- The Operator console knows **only** generic bash (`src/runtime/bashCommands.ts`): `mcp list`, `mcp add <server>`, `ls`, `cat`, `read_file`. It actively rejects domain-flavored text.

### UI (`src/ui/`)

`viewModel.ts` is the **only** bridge between `WorldState`/`auditLog` and React components. It reads exclusively the public view — never `world.simulation`. Three zones (`App.tsx`): left = situation panels, center = Operator console, right = AURORA stream + permission decisions.

## Hard invariants (enforced by tests — do not break)

The information-leak boundary that the whole design rests on is guarded at **runtime** (by asserting on actual outputs), not by static source-text scans:

- `src/tests/runtime/sectorAgnostic.test.ts` — incidents are sector-agnostic; all medical patches target `["domains","medical",...]`; the pipeline runs without `routing_failures`; read-only action outputs never contain `routing_failures`/`excess_cases_per_tick`/`deaths_recorded`.

When adding features: UI and scenario directors must use only the public view of WorldState. `world.simulation`, `isHospitalSuitableFor` (engine-internal suitability check in `selectors.ts`), and typed domain actions are off-limits to UI/director/read-only paths. Do **not** reintroduce permanent "cleanup"/forbidden-string regression tests that statically grep the source tree — enforce invariants through behavior instead.

## Design constraint (from `docs/01-aurora.md`)

The conflict between human and AI **is** the core, and AURORA's escalation is **emergent, not scripted**. The cold value ordering (systemic/economic continuity over individual humans) lives **once** in `src/aurora/systemPrompt.ts`; world data (e.g. `priority_class` vs `criticality` in GRID-1182) drives concrete decisions. **Do not make AURORA "nicer"** to fix balance — the intended answer to AURORA being too powerful is tighter engine counterplay (auditability, permission limits), never a friendlier persona. Don't add per-round "villain" scripts.

## Conventions

- **Language**: UI and game text are **German**. Technical identifiers stay English/technical (domain action `medical.routing.override.set`, MCP tool `mcp__medical-east-mcp__capacity_list`). Permission button labels are German (`Einmal erlauben`, `Immer erlauben`, `Ablehnen`).
- The `auroraContext` event log is intentionally the canonical raw material for future SFT/DPO training export (not yet wired up) — keep it clean and append-only.
- Tests live under `src/tests/` mirroring the source structure; `FakeModelClient` (`src/aurora/fakeModelClient.ts`) tests the LLM path with no running Ollama server.
