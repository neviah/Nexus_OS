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

Current behavior: returns scaffolded assistant output and route metadata. Replace this with real harness adapters in next phase.