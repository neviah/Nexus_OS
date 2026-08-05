# Game Creator Architecture (Draft)

This document defines the first practical architecture for NexusOS Game Creator.

Goals:
- Keep scope controllable for a huge multi-stage product.
- Prevent agent drift by enforcing canonical docs and versioned approvals.
- Support iterative expansion ("add more enemies", "add new enemy types") without restarting the whole project.

## Executive Summary

This architecture treats game creation as a governed production pipeline rather than a freeform prompt loop. The core idea is simple: every major stage must produce a versioned artifact bundle, pass approval gates, and leave behind a clear record of what changed.

That gives NexusOS a practical path to support game-generation workflows without turning the system into an unbounded content generator. The result is a product that can grow from a vertical slice into a larger content pipeline while staying understandable to both humans and agents.

## V1 Scope Boundaries

### In scope
- A single-target first-pass workflow for Unity-based games.
- A setup wizard that produces a structured project spec package.
- Canon docs generation and review gates.
- Enemy-focused expansion workflows after the first playable pass.
- Basic integration with Unity build and test validation.

### Out of scope for V1
- Full multiplayer/live-service game systems.
- Cross-platform content generation for every engine at once.
- Fully autonomous art production with no human review.
- Advanced procedural narrative systems.

## 1) Delivery Strategy

Recommended rollout:
1. V1 target: Unity-first (Unity 3D and/or Unity 2D templates).
2. V1.5 target: Web game adapter using the same planning/docs pipeline.
3. V2 target: multi-target generation (Unity + web + optional others).

Why Unity-first:
- Mature and scriptable project structure.
- Strong asset import pipeline.
- Better fit for 3D + animation-heavy use cases.
- Lower orchestration complexity than dual-target from day one.

## 2) State Machine Model

Use a parent machine with child machines.

Parent states:
1. Intake
2. Preproduction
3. Vertical Slice Build
4. Content Expansion
5. Polish
6. Release Candidate

Each parent state can spawn a child workflow with strict stage contracts.

## 3) Stage Contract Schema (Per Gate)

Every gate uses the same contract shape.

```json
{
  "gateId": "string",
  "gateName": "string",
  "projectId": "string",
  "version": 1,
  "inputs": {
    "required": [],
    "optional": []
  },
  "outputs": {
    "artifacts": [],
    "reports": []
  },
  "approvalChecklist": [
    {
      "id": "string",
      "description": "string",
      "status": "pending|pass|fail",
      "reviewer": "user|agent|mixed"
    }
  ],
  "qualityChecks": [
    {
      "id": "string",
      "type": "design|technical|performance|compliance",
      "result": "pending|pass|fail",
      "details": "string"
    }
  ],
  "failConditions": [
    {
      "id": "string",
      "condition": "string",
      "severity": "warning|blocking",
      "remediation": "string"
    }
  ],
  "exitCriteria": [
    "string"
  ],
  "onFail": {
    "route": "revision_loop|change_request|manual_override",
    "maxAutoRetries": 2
  },
  "audit": {
    "createdAt": "ISO8601",
    "updatedAt": "ISO8601",
    "approvedBy": "string",
    "docVersions": {
      "gameBible": "vX",
      "techDesign": "vX",
      "artBible": "vX"
    }
  }
}
```

## 4) Gate Definitions (V1)

### Gate 1: Concept Approval

Inputs:
- Setup Wizard result package.
- Initial market/scope constraints.

Outputs:
- Approved project direction summary.
- Locked project constraints (genre, perspective, style, scope).

Approval checklist:
- Core fantasy is clear in one sentence.
- Target platform and controls are decided.
- Scope is realistic for selected size.

Fail conditions:
- Contradictory constraints (for example, "pixel art" plus "photoreal cinematic").
- Scope too large for selected timeline/tier.

### Gate 2: Preproduction Docs Approval

Inputs:
- Canon docs draft set.

Outputs:
- Versioned canon docs v1.
- Agent brief bundle generated from canon docs.

Approval checklist:
- Game bible complete.
- Technical design complete.
- UI/controls spec complete.
- Art and lore direction complete.

Fail conditions:
- Missing mandatory sections.
- Major contradiction across docs.

### Gate 3: Art Direction Approval

Purpose:
- Make the visual direction production-ready so downstream asset generation can begin without rework.

Inputs:
- Mood boards and concept sheets.
- Scope constraints and target platform details.
- Initial narrative and gameplay tone notes.

Outputs:
- Approved style kit.
- Reference pack with approved examples.
- Visual production brief covering palette, silhouette, material language, and rendering constraints.

Approval checklist:
- Style is consistent across character/environment/UI.
- Color, silhouette, and readability rules are explicit and testable.
- Material, lighting, and texture expectations are defined for the target platform.
- The style kit is specific enough that a generator can produce assets without guessing.

Fail conditions:
- Visual inconsistency with art bible.
- Missing platform-specific rendering constraints.
- No clear standard for readability, palette, or material treatment.

Production-readiness rule:
- Gate 3 must produce a reusable art brief that downstream asset tasks can reference directly.
- If the brief is still ambiguous, content generation should stop and return to revision.

### Gate 4: Character and Environment Asset Approval

Purpose:
- Convert approved art direction into import-ready, buildable assets with consistent metadata and validation.

Inputs:
- Concept-approved model tasks.
- Gate 3 style kit and visual production brief.
- Target platform export/import rules.

Outputs:
- Approved model set and metadata.
- Import-ready asset package with naming and file conventions.
- Validation report for topology, textures, materials, and export compatibility.

Approval checklist:
- Topology and budgets validated.
- Texture/material budgets validated for the target platform.
- Naming and import conventions pass.
- Export settings, pivot/origin, and scale rules are documented.
- Assets are traceable to the approved style kit and intended gameplay use.

Fail conditions:
- Polygon/material budget breach.
- Invalid export/import diagnostics.
- Asset shape or material language diverges from the approved art direction.
- Missing metadata needed for import into Unity or downstream animation work.

Production-readiness rule:
- Gate 4 must produce a package that can be consumed directly by the next stage without manual cleanup.
- If an asset cannot be imported, renamed, or traced to a production brief, it is not considered ready.

### Gate 3/4 Handoff Contract for Content Production

Before moving to animation, gameplay, or further content generation, the following must exist:
- A signed-off style kit from Gate 3.
- An asset manifest from Gate 4 listing every approved asset, its variant, and its expected use.
- A validation report showing that assets meet the required budgets and import rules.
- A clear mapping from each asset to the corresponding gameplay or encounter requirement.

This handoff is what makes the pipeline actually capable of producing content instead of only producing concepts.

### Gate 5: Animation Approval

Inputs:
- Approved rigged assets.

Outputs:
- Approved animation clips set and transitions table.

Approval checklist:
- Required locomotion and action clips present.
- Clip naming and loop behavior are consistent.

Fail conditions:
- Missing critical clips (idle/move/attack/hit/death where required).
- Root motion setup mismatch with target controller.

### Gate 6: Audio Approval

Inputs:
- Audio bible + scene requirements.

Outputs:
- Approved music stems and SFX packs.

Approval checklist:
- Core loop has music and essential SFX coverage.
- Loudness and format checks pass.

Fail conditions:
- Missing high-priority SFX categories.

### Gate 7: Gameplay Integration Approval

Inputs:
- Approved assets + behavior profiles.

Outputs:
- Playable vertical slice scene.
- Unity shell staging that consumes the approved canon docs and creates the startup/menu flow.

Approval checklist:
- Controls, camera, and UX behavior match specs.
- Encounter flow is playable end-to-end.
- Splash screen, main menu, settings screen, pause overlay, and multi-level scene flow are represented in the Unity shell plan.

Fail conditions:
- Blocking gameplay bugs.
- Performance below minimum target.

Unity shell staging rule:
- The generated Unity authoring project should read the canon docs Nexus produced and translate them into a concrete shell plan, including startup, menu, settings, pause, and multiple level scenes.
- If the canon docs do not describe a surface explicitly, the shell plan may add a placeholder, but it must note that the decision came from the project baseline rather than the doc text.

### Gate 8: Polish and Release Candidate Approval

Inputs:
- Integrated playable build + test reports.

Outputs:
- RC build and release checklist.

Approval checklist:
- Blocking bugs resolved.
- Performance and package checks pass.

Fail conditions:
- Regression against previously approved gates.

## 5) Setup Wizard (V1)

Collect only high-leverage decisions first.

Wizard questions with defaults:
1. Target
- Options: Unity 3D (default), Unity 2D, Web 2D.

2. Genre
- Options: Action-adventure (default), platformer, shooter, RPG, survival, puzzle.

3. Perspective
- Unity 3D: Third-person (default), first-person, top-down, isometric.
- Unity 2D/Web 2D: Side-scroller (default), top-down, isometric.

4. Scope tier
- Options: Mini vertical slice (default), small prototype, medium prototype.

5. Art style
- Options: Stylized low-poly (default), pixel art, hand-painted, realistic.

6. Narrative depth
- Options: Light (default), none, moderate, lore-heavy.

7. Controls
- Options: Keyboard+mouse (default), controller, both.

8. Core loop priority
- Options: Combat (default), exploration, crafting, puzzle, mixed.

9. Difficulty target
- Options: Casual (default), normal, hard.

10. Content baseline
- Fields: enemy families (default 2), biomes (default 1), bosses (default 0).

Branching logic summary:
- If target is Web 2D, hide 3D model/rig requirements and switch to sprite/tileset contracts.
- If style is pixel art, route asset contracts to sprite animation pipeline.
- If narrative depth is lore-heavy, require expanded lore doc sections before Gate 2 approval.
- If controls include controller, require controller mapping checklist in Gate 7.
- If content baseline exceeds scope tier limits, warn and require explicit override.

Wizard output artifact:
- Project Spec Package JSON + human-readable summary markdown.

## 6) Canon Docs Index (Anti-Drift)

Mandatory canon docs for every project:
1. GAME_BIBLE.md
2. TECHNICAL_DESIGN.md
3. UI_UX_SPEC.md
4. CONTROLS_CAMERA_SPEC.md
5. ART_BIBLE.md
6. LORE_BOOK.md
7. AUDIO_BIBLE.md
8. PRODUCTION_PLAN.md
9. ENEMY_ROSTER.md
10. DIFFICULTY_CURVE.md

Minimum required sections:

### GAME_BIBLE.md
- Vision statement
- Player fantasy
- Core loop
- Target audience
- Success criteria

### TECHNICAL_DESIGN.md
- Engine target and version policy
- Project structure
- Runtime systems list
- Build/export pipeline
- Performance targets

### UI_UX_SPEC.md
- Screen map
- UX principles
- HUD wireframes
- Feedback/telemetry events

### CONTROLS_CAMERA_SPEC.md
- Input mapping table
- Camera behavior rules
- Accessibility options

### ART_BIBLE.md
- Visual pillars
- Palette/material language
- Character style guide
- Environment style guide
- UI style bridge

### LORE_BOOK.md
- World rules
- Timeline
- Factions
- Character bios
- Naming conventions

### AUDIO_BIBLE.md
- Music direction
- SFX taxonomy
- Priority scene list
- Loudness/format standards

### PRODUCTION_PLAN.md
- Milestones
- Asset/task backlog
- Risk register
- Approval owners

### ENEMY_ROSTER.md
- Enemy families
- Roles (tank/flanker/ranged/etc.)
- Ability matrix
- Spawn rules by biome

### DIFFICULTY_CURVE.md
- Early/mid/late tuning goals
- Encounter density targets
- DPS/TTK target ranges
- Failure/recovery loops

Versioning rules:
- Every canon doc has semantic content version (v1, v1.1, v2).
- Generation tasks must record the exact canon versions used.
- Scope-changing requests require a document patch before generation begins.

## 7) Expansion Architecture (After First Pass)

After initial playable pass, user requests go into a dedicated expansion workflow.

### Supported expansion request types (V1)

1. add_more_existing_enemy
- Increase quantity of known enemy family without new behavior family.

2. add_new_enemy_type
- Add a net-new enemy family with role and ability profile.

3. extend_enemy_variants
- Add visual and stat variants for an existing family.

4. rebalance_encounters
- Tune spawn composition, pacing, and difficulty curves.

5. upgrade_enemy_ai_template
- Move from basic archetype behavior to richer behavior template.

6. biome_specific_enemy_pack
- Add enemies tied to one biome and its encounter rules.

7. boss_introduction
- Add one boss package with unique mechanics and content bundle.

### Expansion sub-state machine

1. Change Request Intake
- Parse request into a structured object.

2. Impact Analysis
- Compute affected docs, assets, systems, and estimates.

3. Spec Patch Approval
- Patch ENEMY_ROSTER and DIFFICULTY_CURVE (and others as needed).

4. Asset and Behavior Generation
- Generate content per approved spec patch.

5. Integration and Validation
- Technical + balance + performance checks.

6. User Review and Merge
- Keep/revise/reject outcomes and merge approved changes.

### Why this handles "we need more enemies"

Because "more enemies" becomes an explicit request type with:
- Scope boundaries.
- Required doc patch.
- Quality and performance gates.
- Repeatable validation and approvals.

No full restart is needed.

## 8) Enemy AI and Pathing Scope (Tiered)

Do not skip AI and pathing; phase it.

V1 (in scope):
- Archetype templates (melee, ranged, tank, flanker).
- Basic nav/pathing integration.
- Aggro, chase, retreat, and cooldown loops.

V1.5:
- Role coordination basics.
- Patrol zones and alert propagation.
- Encounter composition templates.

V2:
- Advanced tactical coordination.
- Dynamic encounter director.
- Adaptive behavior based on player patterns.

## 9) Unity CLI + MCP Operational Notes (Beginner)

For Unity-target projects, local prerequisites are required.

Minimum assumptions:
1. Unity is installed on the machine.
2. A compatible Unity Editor version for the project is installed.
3. Unity command-line calls can open/build project in batch mode.
4. MCP integration is configured to point at the local Unity tooling surface.

Important practical note:
- Unity does not need the GUI window open all the time if running batch/CLI tasks.
- But Unity must be installed, and the needed editor/toolchain must exist locally.

## 9.5) NexusOS Integration Touchpoints

The Game Creator workflow should plug into existing NexusOS capabilities rather than inventing a parallel stack.

- Workspace management: create and switch project workspaces for each generated game.
- State persistence: store project spec packages, canon doc versions, gate status, and approval history in local state files.
- Task resume engine: preserve long-running generation or review operations so they can continue after interruption.

## 9.6) Execution Orchestration and Queue Discipline

The pipeline should behave like a governed production queue, not a freeform prompt loop.

Core rules:
- Every major stage must be represented as a task with explicit dependencies, inputs, outputs, and approval state.
- Only one task may write to a given artifact at a time.
- Each task must record the canon doc version it used and the exact artifact bundle it produced.
- If a prerequisite artifact is missing or outdated, the task must stop and request a revision rather than proceed on stale assumptions.
- Long-running work should be resumable and should preserve intermediate state so the system can continue after interruption.

Recommended queue model:
- Intake queue: setup wizard, project spec package, and initial approval.
- Doc queue: canon doc drafting and review.
- Asset queue: art and audio production tasks, one batch at a time.
- Integration queue: gameplay wiring, scene assembly, and Unity import validation.
- Polish queue: tuning, balancing, and release candidate checks.

This keeps the LLM workflow serial and understandable. The system can still parallelize low-risk read-only analysis, but content-writing steps should be serialized by artifact ownership.

## 9.7) Unity Handoff Artifact Bundle

For a credible Unity handoff, the workflow must emit a structured handoff bundle at each approved gate.

Minimum contents of the bundle:
- Asset manifest: every approved asset, variant, purpose, and source reference.
- Scene manifest: scenes, scene order, entry points, and required dependencies.
- Prefab and runtime catalog: gameplay objects, spawn points, and controller bindings.
- Gameplay data manifest: enemy roster references, encounter data, difficulty tuning, and reward tables.
- Audio manifest: music stems, SFX packs, loop tags, and scene usage mapping.
- Validation report: import checks, build checks, performance sanity checks, and unresolved issues.
- Build notes: platform-specific export settings, known caveats, and review follow-ups.

Handoff rule:
- If the bundle is incomplete, the next stage must not proceed as if the work were production-ready.
- The Unity shell should consume the bundle directly rather than relying on loose natural-language instructions.

## 9.8) Generator Strategy (Bounded, Structured, Reviewable)

Generators are useful, but they should be treated as draft accelerators rather than final authorities.

Recommended generator families for V1:
- Level and encounter layout generator.
- Dialogue variant generator.
- NPC and enemy profile generator.
- Loot and reward curve generator.
- Audio variation generator for ambience, hits, and UI feedback.

Generator rules:
- Every generator must output structured data first: JSON, YAML, or manifest-based content.
- Generators should be constrained by the approved art bible, difficulty curve, and scope tier.
- They should not invent new visual identity or tone outside the approved style kit.
- Generated output should be reviewable and traceable to the originating spec and canon docs.
- Final content should pass a validation gate before being promoted to the playable build.

This keeps the system practical: generators accelerate iteration, but the canon docs and approval gates stay in control.

## 9.9) Quality Asset Library and Production Floor

Even with good generators, the workflow still needs a quality floor.

The system should maintain a curated starter library of:
- base character silhouettes and modular body parts
- environment tiles, props, and modular set pieces
- UI panels, icons, and HUD elements
- music stems and looping ambience
- SFX layers for impacts, UI, movement, and combat
- animation loop templates for idle, walk, attack, hit, and death states

Why this matters:
- LLMs are good at variation and adaptation, but weak at producing consistently polished first-pass content from nothing.
- A small high-quality library makes the generated content feel more coherent and reduces rework.
- The generator should remix and extend these assets within approved style constraints rather than inventing new visual language on the fly.

Production rule:
- Every generated asset should have a fallback path to a curated base asset if the generated variant is rejected or fails validation.

## 10) Doc-To-System Mapping

The canon docs should directly shape the generated game shell and content defaults:

- `GAME_BIBLE.md` defines the core loop, player fantasy, and menu-to-gameplay intent.
- `UI_UX_SPEC.md` defines screen map, HUD layout, pause behavior, and menu flow.
- `CONTROLS_CAMERA_SPEC.md` defines settings defaults, remapping, camera comfort, and pause/accessibility behavior.
- `ART_BIBLE.md` defines menu styling, HUD styling, enemy silhouette language, and level presentation rules.
- `ENEMY_ROSTER.md` defines enemy families, roles, and encounter-specific behavior expectations.
- `DIFFICULTY_CURVE.md` defines how many levels or progression beats the shell should stage and how pacing changes between them.
- `PRODUCTION_PLAN.md` defines what content must exist before a stage can be considered shippable.
- `AUDIO_BIBLE.md` defines music direction, SFX taxonomy, and scene audio priorities.
- `LORE_BOOK.md` defines world rules, faction naming, and character identity anchors.
- `TECHNICAL_DESIGN.md` defines runtime systems, project structure, and build/export expectations.

Implementation rule:
- If a doc describes a layout, flow, or content contract, the generator should emit that structure explicitly rather than leaving it implied.
- If a doc is silent, the generator may choose a baseline default, but it should record that the value came from the project template and not from canon text.
- Enemy behavior and encounter wiring should be derived from the enemy roster plus the difficulty curve, then expressed as a manifest and runtime catalog so the gameplay scene can consume it directly.
- Router and model orchestration: use Nexus Router for fallback-capable generation calls when content tasks need model switching.
- Unity tool bridge: connect build, test, and log checks to the existing Unity execution policy layer.
- Startup and conformance checks: verify that required tools, engines, and providers are available before starting a build workflow.

This makes the Game Creator flow feel native to NexusOS instead of being bolted on as a separate feature.

## 10) V1 Implementation Priorities

1. Build the Setup Wizard and emit Project Spec Package.
2. Build canon-doc generator from wizard output.
3. Build Gate 1 and Gate 2 workflow engine with approvals.
4. Implement the task queue and artifact-lock model so content stages run one-at-a-time by ownership.
5. Define the Unity handoff bundle schema and validation report format.
6. Implement bounded generators for encounter, dialogue, and enemy content using structured output.
7. Stand up a curated starter asset library and asset manifest pipeline.
8. Build expansion request intake + impact analysis for enemy-related requests.
9. Build Unity adapter for project scaffold + asset import + build checks.

This sequence gives a real end-to-end skeleton before deep content automation.
