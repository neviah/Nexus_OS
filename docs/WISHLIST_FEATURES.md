# NexusOS Wishlist And External Repo Fit

This document evaluates candidate external repos and captures the phased wishlist after the current v1 base.

## Baseline Locked

Current base includes:

- Native Nexus Router provider registry, fallback, and retry.
- Managed harness runtime startup.
- Per-harness chats, schedules, and run history.
- Workspace picker with external folder support.
- Active workspace context propagated to all harness calls.

## External Repo Evaluation

### 1) cheahjs/free-llm-api-resources

Decision: Adopt as a curated source list, not as a runtime dependency.

Why it helps:

- Matches product direction: more free providers to experiment with.
- High value for quickly expanding provider presets.
- Low integration cost if consumed as metadata.

Bloat/risk:

- If imported as a package dependency, value is low and adds maintenance coupling.
- Free-tier limits and provider availability churn frequently.

How to use safely:

- Treat as a periodically refreshed reference dataset.
- Build a Nexus "Provider Preset Catalog" from it.
- Add provider-health and quota warnings in UI.

Priority: P1 (near-term)

---

### 2) Panniantong/Agent-Reach

Decision: Partial adoption via optional adapter profile; do not embed full stack into core runtime.

Why it helps:

- Solves real pain point: web-read/search coverage for agents.
- Multi-source routing approach is useful for resilience.

Bloat/risk:

- Brings many external CLI dependencies, cookies, and platform-specific flows.
- Expands security surface area (credentials/cookies/logins).
- Could make NexusOS fragile if treated as always-on core dependency.

How to use safely:

- Implement as optional "Web Capability Pack" integration profile.
- Keep core NexusOS functioning without it.
- Gate behind explicit enable + diagnostics + per-channel health checks.

Priority: P1.5 (after provider catalog and stability hardening)

---

### 3) rohitg00/agentmemory

Decision: Defer to optional plugin/integration trial; do not adopt as core for v1.

Why it helps:

- Strong long-term-memory system and broad agent support.
- Could improve cross-session and cross-agent context quality.

Bloat/risk:

- Large runtime footprint and operational complexity.
- Additional services/ports/engine model increase maintenance burden.
- Windows setup complexity is non-trivial for current target workflow.

How to use safely:

- Prototype behind a single feature flag in an isolated branch.
- Define measurable success criteria first (latency, token savings, recall quality).
- Keep current native workspace state model as default path.

Priority: P2 experimental

---

### 4) addyosmani/agent-skills

Decision: Adopt selectively as development process guidance, not as runtime product dependency.

Why it helps:

- Useful engineering workflow patterns for quality and release discipline.
- Can improve implementation consistency and review rigor.

Bloat/risk:

- Runtime value to end-users is indirect.
- Full ingestion is too broad for current scope.

How to use safely:

- Pull a small subset into internal contributor docs/checklists.
- Use for CI/review standards, not app runtime logic.

Priority: P1 internal process

## Wishlist Feature Backlog

### Phase A: High ROI, low bloat (next)

1. Free Provider Preset Catalog
- Expand provider presets from curated free-provider sources.
- Include quota/rate-limit notes and health checks.

2. Web Capability Pack (optional)
- Basic read/search tooling for harnesses via controlled integrations.
- Keep disabled by default and independently diagnosable.

3. TTS Voice Output (Piper)
- Add local/offline TTS output for harness responses.
- Start with one-click local voice profile and playback controls.

### Phase B: Creator tools

1. Image generation
- Flux and/or Ideogram integration behind tool cards.

2. Cookbook feature
- Saved prompt/recipe system per workspace/harness.

3. Video generation
- Start with external API connector interface and job queue.

### Phase C: Extended multimodal

1. 3D model generation
2. Music generation

## Anti-Bloat Guardrails

Before adding any new external system, require:

1. Optional-by-default architecture (no hard dependency for core chat/router flow).
2. Clear failure mode (degrade gracefully when integration is unavailable).
3. Workspace-safe credential handling.
4. Measurable win over current baseline.
5. Removal path (integration can be disabled/uninstalled cleanly).

## Suggested Next Implementation Slice

1. Provider Preset Catalog ingestion + UI filters for free tiers.
2. Optional Web Capability Pack adapter with diagnostics panel.
3. Piper local TTS tool card and playback controls.
