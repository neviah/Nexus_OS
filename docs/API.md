# NEXUS OS API (Scaffold)

## Health

- `GET /api/health`

## Bootstrap

- `GET /api/bootstrap`
  - Returns first-run onboarding state, harness/tool status, router summary, and workspace list.

## Harnesses

- `GET /api/harnesses`
  - Returns harness registry with online/offline probe status.
- `GET /api/harnesses/conformance`
  - Runs configuration and live endpoint conformance checks per harness profile.

## Startup Readiness

- `GET /api/startup/check`
  - Runs live startup checks with protocol probes and returns startup blockers + per-harness conformance summary.
  - Persists check result to history.
- `GET /api/startup/check/last`
  - Returns the last recorded startup check result with timestamp.

## 9router

- `GET /api/tools/9router/status`
- `POST /api/tools/9router/config`

Request body:

```json
{
  "apiKey": "string",
  "baseUrl": "https://api.9router.io/v1",
  "defaultModel": "deepseek-v3",
  "fallbackOrder": ["deepseek-v3", "qwen-2.5-72b", "claude-3.5-sonnet"]
}
```

## Nexus Router (Native)

- `GET /api/router/providers`
  - Returns saved router providers (API keys masked).
- `POST /api/router/providers`
  - Upserts provider config.
- `GET /api/router/models?providerId=<id>`
  - Syncs and caches models from provider `/v1/models` endpoint.
- `GET /api/router/config`
  - Returns fallback chain + retry policy + recent router logs.
- `POST /api/router/config`
  - Updates fallback chain and/or retry policy.
- `POST /api/router/chat`
  - Executes OpenAI-compatible routed chat using retry + fallback.

Example provider upsert request:

```json
{
  "id": "openrouter-main",
  "name": "OpenRouter Main",
  "type": "openrouter",
  "baseUrl": "https://openrouter.ai/api/v1",
  "apiKey": "sk-or-v1-...",
  "enabled": true,
  "defaultModel": "openai/gpt-4.1-mini"
}
```

Example router chat request:

```json
{
  "messages": [
    { "role": "user", "content": "Write a TypeScript retry helper" }
  ],
  "fallbackChain": [
    { "providerId": "openrouter-main", "model": "openai/gpt-4.1-mini" },
    { "providerId": "openrouter-main", "model": "anthropic/claude-sonnet-4" }
  ]
}
```

## Workspaces

- `GET /api/workspaces`
- `POST /api/workspaces`
- `DELETE /api/workspaces/:id`
- `POST /api/workspaces/switch`
- `GET /api/workspaces/:id/tree`

## Chat

- `POST /api/chat`
- `POST /api/chat/stream`
- `POST /api/chat/stop`
- `GET /api/chat/tasks/resumable`
- `POST /api/chat/tasks/:requestId/resume`

`POST /api/chat` now uses the harness adapter layer and attempts:

1. Generic harness endpoint (`/api/chat` or `/chat`)
2. OpenAI-compatible endpoint (`/v1/chat/completions`)
3. Model fallback based on configured 9router fallback order

`POST /api/chat/stream` returns SSE frames with envelope payloads:

```json
{ "type": "meta", "meta": { "model": "...", "provider": "9router", "fallbackUsed": false, "elapsedMs": 0, "tokenUsage": { "input": 20, "output": 0 } } }
{ "type": "delta", "text": "token" }
{ "type": "done" }
```

`POST /api/chat/stop` expects:

```json
{ "requestId": "uuid" }
```

and aborts the matching in-flight stream.

`GET /api/chat/tasks/resumable` returns failed tasks that can be resumed.

`POST /api/chat/tasks/:requestId/resume` replays a failed task using the task resume engine and returns resumed output.

## Unity Tool Bridge

- `GET /api/tools/unity/status?workspaceId=<optional>`
  - Returns Unity Editor discovery, Unity CLI Loop availability, and active Unity policy state.
- `GET /api/tools/unity/approval`
  - Returns enable/disable state plus approval metadata (changedBy/changedAt/expiresAt).
- `POST /api/tools/unity/approval`
  - Enables or disables Unity tool execution. Supports optional timed approvals.
- `GET /api/tools/unity/policy`
  - Returns full Unity policy.
- `POST /api/tools/unity/policy`
  - Updates policy fields (allowed actions, dynamic code toggle, harness allowlist, per-turn limits).
- `POST /api/tools/unity/:action`
  - Executes one Unity CLI Loop action (`unity_compile`, `unity_run_tests`, `unity_get_logs`, `unity_screenshot`, `unity_execute_dynamic_code`).
- `GET /api/tools/unity/audit?limit=<1..500>`
  - Returns recent Unity action audit records (blocked/executed/failed).
- `GET /api/tools/unity/approval/audit?limit=<1..500>`
  - Returns recent Unity approval/provenance records.

Example timed approval request:

```json
{
  "enabled": true,
  "durationMinutes": 30,
  "actor": "ui:settings",
  "reason": "temporary compile and test pass"
}
```

Example policy update request:

```json
{
  "allowedActions": ["unity_compile", "unity_run_tests", "unity_get_logs", "unity_screenshot"],
  "allowDynamicCode": false,
  "harnessAllowlist": ["hermes", "grok4"],
  "maxActionsPerTurn": 2,
  "maxDynamicCodeChars": 2000,
  "actor": "ui:settings",
  "reason": "tighten policy"
}
```

## Runtime Trust Policy

- `GET /api/tools/runtimes/policy`
  - Returns runtime install/download policy settings.
- `POST /api/tools/runtimes/policy`
  - Updates runtime policy (`installEnabled`, `allowDirectInstallApi`, `allowedJobActions`, `pullModelAllowPattern`, `allowedSourceDomains`, `expectedArtifactSha256`, `requireSignedArtifactManifest`, `trustedManifestKeyIds`).
- `GET /api/tools/runtimes/audit?limit=<1..500>`
  - Returns recent runtime install/download audit records with checkpoint and rollback outcomes.

Runtime policy is enforced for:

- `POST /api/tools/runtimes/jobs`
- `POST /api/tools/runtimes/jobs/:jobId/retry`
- `POST /api/tools/runtimes/install`

When blocked by policy, endpoints return HTTP `412` with a descriptive error message plus structured diagnostics:

```json
{
  "error": "Runtime action install-piper is blocked by trust policy.",
  "code": "action_blocked",
  "details": {
    "action": "install-piper",
    "allowedJobActions": ["start-ollama"]
  }
}
```

Supported denial codes include `install_disabled`, `action_blocked`, `domain_blocked`, `model_required`, `model_pattern_blocked`, and `policy_regex_invalid`.

Signed-manifest verification reads from:

- `config/runtime-trust-public-keys.json` (RSA-SHA256 public keys)
- `config/runtime-artifact-manifests.json` (signed artifact manifest records)

If `requireSignedArtifactManifest` is true, runtime install integrity checks fail when a required artifact lacks a valid trusted manifest signature.

`POST /api/tools/unity/:action` may include a `rollback` object in failure responses when automatic project file rollback was attempted.

Example runtime policy update:

```json
{
  "installEnabled": true,
  "allowDirectInstallApi": false,
  "allowedJobActions": [
    "install-ollama",
    "start-ollama",
    "pull-ollama-model",
    "install-piper",
    "install-default-piper-voice",
    "install-acejam",
    "start-acejam",
    "install-wan2gp",
    "start-wan2gp",
    "install-hunyuan3d",
    "start-hunyuan3d",
    "install-animato",
    "start-animato"
  ],
  "pullModelAllowPattern": "^[a-z0-9._:-]{1,120}$",
  "allowedSourceDomains": [
    "github.com",
    "objects.githubusercontent.com",
    "download.pytorch.org",
    "pypi.org",
    "files.pythonhosted.org",
    "huggingface.co",
    "ollama.com"
  ],
  "expectedArtifactSha256": {},
  "requireSignedArtifactManifest": false,
  "trustedManifestKeyIds": []
}
```

## Nexus Autopilot Loop

- `GET /api/tools/autopilot-loop/profile`
  - Returns current Autopilot profile config and effective fallback chain.
- `POST /api/tools/autopilot-loop/profile`
  - Updates profile settings (`free`, `cost`, `custom`), budget limits, harness id, and optional custom chain.
- `GET /api/tools/autopilot-loop/status?workspaceId=<optional>`
  - Returns profile, effective chain source, queue summary, and latest execution run state.
- `GET /api/tools/autopilot-loop/journal?workspaceId=<optional>&limit=<optional>`
  - Returns most recent execution journal entries for live UI streaming and resume context.
- `POST /api/tools/autopilot-loop/run-start`
  - Starts an asynchronous Autopilot run in the background.
- `POST /api/tools/autopilot-loop/stop`
  - Requests cooperative stop for the active Autopilot run.
- `POST /api/tools/autopilot-loop/resume`
  - Resumes from the last known journal checkpoint/run state.

Profile rules:

- `free`
  - Default mode. Uses curated no-cost model order and must not auto-switch to paid profile.
- `cost`
  - Paid-capable mode. Must be explicitly selected by the user.
- `custom`
  - Uses custom fallback chain from Autopilot config, else per-agent router assignment (`autopilot-loop`), else router defaults.

Example profile update:

```json
{
  "profile": "free",
  "backendHarnessId": "hermes",
  "maxSteps": 20,
  "maxDurationMinutes": 90,
  "maxRetriesPerTask": 2,
  "customFallbackChain": []
}
```

Example bounded run request:

```json
{
  "workspaceId": "default",
  "mode": "strict-approval",
  "maxSteps": 12
}
```

## Wan2GP Media

- `GET /api/tools/wan2gp/status`
  - Returns Wan2GP runtime readiness, machine profile hint, installed model hints, and model catalog.
  - `recommended.video` is profile-aware and now prioritizes MiniMax H3-compatible models when installed.
  - `videoPresets` includes compatibility and H3-tuned presets (for example `h3-balanced`, `h3-quality`, `h3-low-vram`) when applicable.
- `GET /api/tools/wan2gp/image/stream?...`
  - SSE image generation stream. Uses installed-only model routing.
- `GET /api/tools/wan2gp/video/stream?...`
  - SSE video generation stream. Uses installed-only model routing with auto model fallback when `model=auto`.

Operational note:

- Re-running runtime job action `install-wan2gp` refreshes the Wan2GP base from upstream before dependency/install checks.