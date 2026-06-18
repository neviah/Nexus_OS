# NEXUS OS API (Scaffold)

## Health

- `GET /api/health`

## Bootstrap

- `GET /api/bootstrap`
  - Returns first-run onboarding state, harness/tool status, router summary, and workspace list.

## Harnesses

- `GET /api/harnesses`
  - Returns harness registry with online/offline probe status.

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