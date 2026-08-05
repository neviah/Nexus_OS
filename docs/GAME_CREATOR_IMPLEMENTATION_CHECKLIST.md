# Game Creator Implementation Checklist

This checklist translates the architecture into concrete implementation work with validation points.

## Phase 1: Foundation and Contracts

- [ ] Finalize Game Creator spec package schema and defaults.
- [ ] Freeze canon doc templates and mandatory section checks.
- [ ] Define Gate 2 readiness policy for strict-approval vs auto-produce.
- [ ] Define Unity handoff bundle schema (asset, scene, prefab, gameplay, audio, validation).
- [ ] Define artifact provenance schema for all generated outputs.

Exit criteria:
- [ ] Schema docs are versioned and checked into docs.
- [ ] API rejects invalid payloads and missing required fields.

## Phase 2: Queue and Execution Loop

- [ ] Build queue from approved canon docs with explicit dependencies.
- [ ] Enforce one-writer-at-a-time artifact ownership.
- [ ] Add run-next execution path for deterministic single-step work.
- [ ] Add run-all execution loop with pause/resume/stop controls.
- [ ] Persist execution jobs, artifacts, and run state for recovery.

Exit criteria:
- [ ] Queue can be built, inspected, and resumed after restart.
- [ ] No two jobs can write the same artifact concurrently.

## Phase 3: Gate 3/4 and Unity Handoff

- [ ] Generate Gate 3 style kit + production brief artifacts.
- [ ] Generate Gate 4 import package + validation report artifacts.
- [ ] Build animation readiness manifest from Gate 3/4 outputs.
- [ ] Stage Unity authoring project from Gate 4 handoff files.
- [ ] Run Unity smoke and performance gate checks.

Exit criteria:
- [ ] Unity handoff can be generated without manual file reconstruction.
- [ ] QA logs and validation reports are attached to the run.

## Phase 4: Bounded Generators

- [ ] Encounter/level generator (structured manifest output).
- [ ] Dialogue variation generator (tone + constraints from canon docs).
- [ ] NPC/enemy generator (role, stats, behavior profile output).
- [ ] Loot/reward generator (curve-aware and scope-aware output).
- [ ] Audio variation generator (ambience and SFX layers).

Exit criteria:
- [ ] Each generator outputs structured data, not freeform only.
- [ ] Generated output references source docs and spec version.

## Phase 5: Quality Floor and Asset Library

- [ ] Seed curated base assets (characters, environments, UI, audio, animations).
- [ ] Add quality budgets (poly, texture, memory, loudness, duration).
- [ ] Add fallback-to-curated-asset behavior for rejected generations.
- [ ] Add provenance and licensing metadata for all shipped assets.

Exit criteria:
- [ ] Rejected generated content can be replaced automatically.
- [ ] Release package includes asset quality and provenance report.

## Phase 6: Release and Telemetry

- [ ] Build release packaging and blocker report output.
- [ ] Add workflow telemetry timeline and stage-level metrics.
- [ ] Add compliance summary checks to release readiness.
- [ ] Add reproducibility metadata (run id, docs versions, generator versions).

Exit criteria:
- [ ] Release package is deterministic and auditable.
- [ ] Workflow can explain what changed, why, and from which stage.

## Immediate Next Sprint (Recommended)

- [ ] Connect workflow run endpoint to execute first actionable stages.
- [ ] Add execution journal artifacts per queue step.
- [ ] Add queue starvation detection and blocker diagnostics.
- [ ] Add dashboard cards for queue health and gate readiness.
- [ ] Add at least one end-to-end API test for workflow run + queue build + run-next.

## Autopilot Loop Agent MVP (New)

- [ ] Add dedicated menu agent: Nexus Autopilot Loop.
- [ ] Add profile selector with three modes: Free, Cost, Custom.
- [ ] Set default profile to Free with curated no-cost model chain.
- [ ] Add per-agent router assignment lookup for autopilot-loop custom mode.
- [ ] Reuse existing run-next and run-all queue loop with run-until-blocker control.
- [ ] Add journal API endpoint and UI panel for per-step execution logs.
- [ ] Add hard stop controls (max steps, max duration, repeated-failure pause).
- [ ] Add one end-to-end test for Free profile loop execution.

Autopilot MVP reference:
- See docs/AUTOPILOT_LOOP_AGENT_SPEC.md for detailed draft behavior and profile policy.
