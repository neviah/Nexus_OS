# Game Creator Architecture (Draft)

This document defines the first practical architecture for NexusOS Game Creator.

Goals:
- Keep scope controllable for a huge multi-stage product.
- Prevent agent drift by enforcing canonical docs and versioned approvals.
- Support iterative expansion ("add more enemies", "add new enemy types") without restarting the whole project.

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

Inputs:
- Mood boards and concept sheets.

Outputs:
- Approved style kit and reference pack.

Approval checklist:
- Style is consistent across character/environment/UI.
- Color and silhouette readability meets targets.

Fail conditions:
- Visual inconsistency with art bible.

### Gate 4: Character and Environment Asset Approval

Inputs:
- Concept-approved model tasks.

Outputs:
- Approved model set and metadata.

Approval checklist:
- Topology and budgets validated.
- Naming and import conventions pass.

Fail conditions:
- Polygon/material budget breach.
- Invalid export/import diagnostics.

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

Approval checklist:
- Controls, camera, and UX behavior match specs.
- Encounter flow is playable end-to-end.

Fail conditions:
- Blocking gameplay bugs.
- Performance below minimum target.

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

## 10) V1 Implementation Priorities

1. Build the Setup Wizard and emit Project Spec Package.
2. Build canon-doc generator from wizard output.
3. Build Gate 1 and Gate 2 workflow engine with approvals.
4. Build expansion request intake + impact analysis for enemy-related requests.
5. Build Unity adapter for project scaffold + asset import + build checks.

This sequence gives a real end-to-end skeleton before deep content automation.
