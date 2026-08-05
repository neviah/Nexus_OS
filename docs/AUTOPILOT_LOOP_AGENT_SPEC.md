# Nexus Autopilot Loop Agent Spec (Draft)

## Purpose

Create a separate menu agent dedicated to autonomous task execution loops so it does not interfere with normal chat and coding agents.

Primary outcomes:
- Break goals into executable tasks.
- Execute one task at a time.
- Record each step in a journal.
- Re-check completion criteria after every step.
- Continue until complete, blocked, paused, or canceled.

## Product Positioning

- Agent name: Nexus Autopilot Loop
- Agent type: opt-in execution agent
- Default behavior: conservative, cost-aware, reviewable
- Intended use: long multi-step workflows (for example, Game Creator pipeline runs)

## Input Contract (Required)

Every run must include:
- objective: one clear target outcome
- doneDefinition: measurable completion criteria
- constraints: scope boundaries, forbidden operations, quality rules
- riskPolicy: what requires pause-for-approval
- budget: maxSteps, maxDurationMinutes, maxRetriesPerTask

Example run payload (draft):

```json
{
  "objective": "Produce Unity-ready vertical slice assets and queue reports.",
  "doneDefinition": [
    "Queue has no ready items remaining.",
    "All gate blockers are resolved or explicitly deferred.",
    "Release readiness report exists."
  ],
  "constraints": {
    "allowDestructiveFileOps": false,
    "requireVerificationEvidence": true,
    "allowedLanes": ["design", "content", "art", "audio", "qa"]
  },
  "riskPolicy": {
    "pauseOnPolicyViolation": true,
    "pauseOnRepeatedFailure": 2,
    "requireApprovalFor": ["unity_execute_dynamic_code", "delete"]
  },
  "budget": {
    "maxSteps": 30,
    "maxDurationMinutes": 90,
    "maxRetriesPerTask": 2
  }
}
```

## Loop Runtime Contract

Execution loop:
1. Parse objective and constraints into a task graph.
2. Pick next executable task with dependency and blocker checks.
3. Execute task.
4. Verify with real checks.
5. Append execution journal entry.
6. Evaluate completion.
7. Continue or stop.

Stop conditions:
- doneDefinition is satisfied with verification evidence
- no executable task remains
- budget exceeded
- repeated failure threshold reached
- policy block encountered
- user pause or cancel

## Journal and Audit Requirements

Each iteration must log:
- timestamp
- selected profile and model
- task attempted
- files or artifacts changed
- verification evidence summary
- blocker or failure reason (if any)
- completion status after this step

Journal location:
- GameBuild/workflow/execution-journal.md

## Model Profile Policy

The agent must expose three profiles:

1. Free
- Goal: avoid paid models by default.
- Default profile at first run.
- Uses a curated free model chain.

2. Cost
- Goal: allow paid models when user explicitly chooses quality/speed over cost.
- Never auto-switch from Free to Cost.

3. Custom
- Goal: use router defaults set specifically for this agent.
- If not explicitly configured for this agent, inherit global router default.

### Default Profile Chains (Draft)

Free profile chain (recommended initial order):
1. deepseek-v3
2. qwen-2.5-72b
3. qwen-coder-plus

Cost profile chain (example):
1. claude-3.7-sonnet
2. claude-3.5-sonnet
3. deepseek-v3

Custom profile chain:
- Use nexusRouter.harnessAssignments["autopilot-loop"] if present.
- Fallback to global router default model and fallback chain.

Profile guardrails:
- Free profile must not call paid models.
- Cost profile usage must be explicit and visible in run metadata.
- Custom profile must display effective model chain before run starts.

## Backend Harness Recommendation

Recommended harness shell:
- Hermes

Reasoning:
- Hybrid adapter shape fits mixed execution patterns.
- Existing Nexus Router integration provides retries and fallback.
- Keeps loop logic in Nexus while routing model choice centrally.

Routing policy recommendation:
- Always execute through Nexus Router.
- Attach per-agent routing assignment for autopilot-loop.
- Keep strict retry limits to prevent runaway loops.

## API Surface (Draft)

Suggested endpoints:
- POST /api/tools/autopilot-loop/run
- POST /api/tools/autopilot-loop/run-until-blocker
- POST /api/tools/autopilot-loop/run-step
- POST /api/tools/autopilot-loop/pause
- POST /api/tools/autopilot-loop/resume
- POST /api/tools/autopilot-loop/stop
- GET /api/tools/autopilot-loop/status
- GET /api/tools/autopilot-loop/journal
- POST /api/tools/autopilot-loop/profile

Profile endpoint payload (draft):

```json
{
  "profile": "free",
  "customChain": []
}
```

Allowed profile values:
- free
- cost
- custom

## UI Contract (Draft)

Menu entry:
- Add a dedicated Agent card named Nexus Autopilot Loop.

Run controls:
- Run one step
- Run until blocker
- Run bounded run-all
- Pause
- Resume
- Stop

Profile controls:
- Profile selector: Free, Cost, Custom
- Show effective model chain before run start
- Show a cost warning only when Cost profile is selected

Status panel:
- current step
- queue health
- blocker reason
- profile and effective model
- completion confidence

## MVP Build Order

1. Add profile persistence for autopilot-loop (free/cost/custom).
2. Add per-agent router assignment resolution.
3. Add agent menu entry and profile selector.
4. Reuse existing queue run-next/run-all engine for execution.
5. Add run-until-blocker endpoint alias over existing execution loop.
6. Expose execution journal in API and UI.
7. Add safeguards: max steps, retries, and repeated-failure pause.

## Acceptance Criteria (MVP)

- Agent appears separately in menu and does not alter normal harness chat flow.
- Default profile is Free and uses only curated free model chain.
- User can switch to Cost or Custom profile explicitly.
- Agent can run task loops with journal entries for each step.
- Agent stops at blocker and reports a clear reason.
- Agent reports completion only when doneDefinition is satisfied with evidence.
