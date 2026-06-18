# NEXUS OS

NEXUS OS is a local-first mission control dashboard for running multiple AI harnesses in one unified operating layer.

## What Is Implemented Now

- 3-pane mission control UI (agents/tools, unified center panel, workspace/file tree)
- Backend harness registry and health probe layer
- First-run onboarding that forces users into `9router` setup first
- 9router settings panel (API key, base URL, default model, fallback order)
- Workspace manager (create/switch/delete + file tree + metadata)
- Harness adapter layer with OpenAI-compatible and generic harness endpoint support
- Per-harness adapter compatibility config (protocol/auth/path/stream strategy)
- Streaming chat with token-by-token updates
- Stop + Resend controls in unified chat status bar
- Persistent local runtime state (`data/system-state.local.json`) initialized from template
- Pinokio launcher files (`install.js`, `start.js`, `reset.js`, `update.js`, `pinokio.js`, `pinokio.json`)

## Repo Layout

- `apps/web` - React + TypeScript frontend
- `apps/api` - Node.js + Express API
- `config/harnesses.json` - Harness registry source of truth
- `data/workspaces` - Shared workspace folders
- `data/system-state.template.json` - First-run runtime state template

## Quick Start

1. Install dependencies:

```bash
npm install
npm --prefix apps/api install
npm --prefix apps/web install
```

2. Start backend and frontend together:

```bash
npm run dev
```

3. Open frontend URL shown by Vite (usually `http://localhost:5173`).

4. First launch flow:

- Go to `9router` tool panel
- Enter your 9router API key
- Save config
- Select an agent and begin chats

## Run With Pinokio

The repository includes native Pinokio launcher scripts at the project root.

- `install.js`: installs root and app dependencies
- `start.js`: runs backend + frontend and publishes web URL to Pinokio
- `update.js`: pulls latest changes and refreshes dependencies
- `reset.js`: clears dependencies/build output and local runtime state
- `pinokio.js` + `pinokio.json`: Pinokio menu and metadata

In Pinokio:

1. Open this repo as an app.
2. Click `Install`.
3. Click `Start`.
4. Open `Open NEXUS OS`.

## Harness Compatibility Tuning

Each harness supports adapter overrides in `config/harnesses.json` under `adapter`:

- `protocol`: `openai | generic | hybrid`
- `streamProtocol`: `openai-sse | custom-sse | none`
- `authMode`: `bearer | x-api-key | both | none`
- `healthPath`: health probe path
- `openAiPath`: OpenAI-compatible chat path
- `genericPaths`: generic JSON chat paths
- `streamPath`: generic SSE stream path

This allows integrating harnesses with different API shapes without changing frontend code.

## Important Security Note

User API keys are stored only in `data/system-state.local.json` (gitignored). Do not commit secrets.

## Next Implementation Steps

- Add Whisper (STT) and Piper (TTS) integration services
- Add cookbook module for local model installs
- Add task resume/replay with retry policy controls