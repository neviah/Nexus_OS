# NEXUS Router Architecture (Phase 1)

This document is the fallback blueprint for the native Nexus Router. It is intentionally practical and tied to current implementation.

## Goals

- Route harness inference through a Nexus-owned router layer.
- Store provider API keys locally (gitignored state).
- Discover provider model catalogs.
- Execute fallback chains with retry policy.
- Keep detailed operational logs for diagnostics and replay.

## Current Scope (Implemented)

- Provider registry persistence in `system-state` under `nexusRouter.providers`.
- Retry policy persistence in `nexusRouter.retryPolicy`.
- Fallback chain persistence in `nexusRouter.fallbackChain`.
- Provider model sync for OpenAI-compatible `/v1/models` APIs.
- Routed chat execution for OpenAI-compatible `/v1/chat/completions` APIs.
- Retry + fallback behavior with attempt trace output.

## Data Model

Stored at `data/system-state.local.json` (from template `data/system-state.template.json`):

- `nexusRouter.providers[]`
  - `id`, `name`, `type`, `baseUrl`, `apiKey`, `enabled`, `defaultModel`, `models[]`, `lastSyncedAt`
- `nexusRouter.fallbackChain[]`
  - `{ providerId, model }`
- `nexusRouter.retryPolicy`
  - `maxAttempts`, `backoffMs`, `retryOnStatus[]`
- `nexusRouter.logs[]`
  - `{ timestamp, level, message }`

## API Surface (Phase 1)

- `GET /api/router/providers`
  - Returns provider list with masked keys.
- `POST /api/router/providers`
  - Upserts provider connection.
- `GET /api/router/models?providerId=<id>`
  - Syncs provider models and stores cache.
- `GET /api/router/config`
  - Returns fallback chain, retry policy, and recent router logs.
- `POST /api/router/config`
  - Updates fallback chain and/or retry policy.
- `POST /api/router/chat`
  - Executes routed chat with retries and fallback.

## Routed Chat Algorithm

1. Resolve targets from request:
   - explicit `{providerId, model}` if supplied,
   - else request fallback chain,
   - else stored `nexusRouter.fallbackChain`.
2. For each target:
   - Verify provider exists and is enabled.
   - Retry the provider call up to `maxAttempts`.
   - Retry only on `retryOnStatus` (HTTP).
3. On success:
   - Return first successful response.
4. On full failure:
   - Return 502 with concatenated attempt details.

## Security Notes

- Provider API keys are persisted only in local state and should never be committed.
- API responses return masked keys, never raw values.
- For production deployment, add encryption-at-rest for provider secrets.

## Planned Next Steps

- Add provider health scoring and circuit-breaker windows.
- Add streaming routed chat endpoint.
- Add per-harness routing profiles.
- Add UI for provider connect/test/model sync/fallback builder.
- Add request replay policy and dead-letter queue for failed runs.

## Related Docs

- Wishlist and external repo fit analysis: `docs/WISHLIST_FEATURES.md`
