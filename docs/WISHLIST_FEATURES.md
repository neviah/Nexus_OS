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

---

### 5) CodebuffAI/codebuff (Freebuff)

Decision: Add as a harness. Freebuff is the fully free, ad-supported tier.

What it is:

- Terminal-based AI coding agent with a multi-agent pipeline: file picker, planner, editor, reviewer.
- `npm install -g freebuff` — no API key, no subscription, runs immediately.
- Uses open-source models: DeepSeek, Kimi, MiniMax, Gemini Flash.
- Has built-in web research and browser capability.
- Claims 61% vs 53% over Claude Code on their own coding benchmarks.

Why it helps:

- Fits the free-model philosophy perfectly.
- Exposes an HTTP endpoint when running, wires into the harness adapter the same way Hermes/OpenClaw do.
- Different internal architecture (multi-agent pipeline) gives users a meaningfully different option alongside existing harnesses.

Bloat/risk:

- Limited mode applies outside US/CA/UK/EU or when using VPN.
- Ad-supported model may change terms; treat it like any external free service.

Priority: P1 (near-term harness addition)

---

### 6) NO6KIKO/gorest-2d-animation-spritesheet-generator

Decision: Skip this specific repo. Track the category for Game Creator tooling.

What it is:

- Codex-assisted local tool for generating 2D spritesheets and compositing scenes.
- Early-stage proof of concept, not production-ready infrastructure.

Why it matters:

- The concept fits the Game Creator vision: code generation + music + sprite images + animation.
- When Game Creator tooling is built, 2D animation/spritesheet support belongs as a component.

What to do:

- Do not take this repo as a dependency.
- Add "2D animation and spritesheet tooling" as a Game Creator sub-component in Phase D.

Priority: P3 (Game Creator phase)

---

### 7) darkzOGx/youtube-automation-agent

Decision: Add to wishlist under Social Media Center tool card.

What it is:

- Automated YouTube channel management: script writing, thumbnail generation, upload, scheduling.
- Supports free Gemini API path (Google AI Studio free tier) as well as OpenAI.

Why it helps:

- Gemini Flash free tier is a real, no-cost path for script generation and metadata.
- Social Media Center is a natural tools-section addition, and YouTube is the highest-value target.

Bloat/risk:

- Upload and publishing involves YouTube Data API credentials and OAuth flows.
- Full quality (HD thumbnail generation, long-form scripting) pushes toward paid tiers.
- Implement as a strictly opt-in tool card with credential isolation; do not touch core harness flow.

Priority: P2 (Social Media Center phase)

---

### 8) mrtooher/fable-mode

Decision: Add as a behavior profile for the Free-Claude-Code harness, not a new standalone harness.

What it is:

- A single SKILL.md (not a server, not an API) that modifies how Claude Code tackles complex tasks.
- Forces: written stage plan → delegate independent sub-work → per-stage failable verification → self-critique before delivery.
- Has three variants: fable-mode (inline), fable-sonnet (Sonnet subagent), fable-haiku (Haiku subagent).
- The author explicitly states it does not raise the model's reasoning ceiling; it imposes structure the model would otherwise skip.

Why it helps:

- No new harness needed; drop the SKILL.md into the Free-Claude-Code harness skills directory or system prompt.
- Measurable improvement on multi-file, multi-session tasks where staged execution matters.
- Zero runtime footprint.

Bloat/risk:

- Minimal. It's 100 lines of markdown.
- On simple tasks it wastes tokens — only activate on complex task routing.

How to implement:

- Add fable-mode SKILL.md to the Free-Claude-Code harness profile.
- Optionally expose as a toggleable "Fable Mode" setting per harness in Router Console.

Priority: P1 (low effort, high signal quality improvement)

## Wishlist Feature Backlog

### Phase A: High ROI, low bloat (next)

1. Free Provider Preset Catalog
- Expand provider presets from curated free-provider sources.
- Include quota/rate-limit notes and health checks.

2. Freebuff Harness
- Add Freebuff as a registered harness alongside Hermes/OpenClaw.
- No API key required; `npm install -g freebuff` and point endpoint at local server.

3. Fable-Mode Behavior Profile
- Drop fable-mode SKILL.md into Free-Claude-Code harness.
- Optional toggle in Router Console per harness; off by default on simple tasks.

4. Web Capability Pack (optional)
- Basic read/search tooling for harnesses via controlled integrations.
- Keep disabled by default and independently diagnosable.

5. TTS Voice Output (Piper)
- Add local/offline TTS output for harness responses.
- Start with one-click local voice profile and playback controls.

### Phase B: Creator tools

1. Image generation
- Flux and/or Ideogram integration behind tool cards.

2. Cookbook feature
- Saved prompt/recipe system per workspace/harness.

3. Video generation
- Start with external API connector interface and job queue.

4. Social Media Center (YouTube first)
- YouTube automation tool card using free Gemini AI Studio tier.
- Credential isolation, opt-in only, no impact to core harness routing.

### Phase C: Extended multimodal

1. 3D model generation
2. Music generation

### Phase D: Game Creator tools

1. Game Creator tool section
- Code generation via existing harnesses.
- Sprite/image generation via image generator tool.
- Music generation via music generator tool.
- 2D animation and spritesheet tooling (evaluate best available option at implementation time; gorest-2d-animation-spritesheet-generator is a reference, not a dependency).

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
