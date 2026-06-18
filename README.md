# NEXUS OS

NEXUS OS is a local-first mission control dashboard for running multiple AI harnesses in one unified operating layer.

## What Is Implemented Now

- 3-pane mission control UI (agents/tools, unified center panel, workspace/file tree)
- Backend harness registry and health probe layer
- First-run onboarding that forces users into `9router` setup first
- 9router settings panel (API key, base URL, default model, fallback order)
- Workspace manager (create/switch/delete + file tree + metadata)
- Unified chat scaffold endpoint that routes through a 9router abstraction stub
- Persistent local runtime state (`data/system-state.local.json`) initialized from template

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

## Important Security Note

User API keys are stored only in `data/system-state.local.json` (gitignored). Do not commit secrets.

## Next Implementation Steps

- Replace chat scaffold endpoint with real harness adapters
- Add streaming token output and stop/resend controls
- Add Whisper (STT) and Piper (TTS) integration services
- Add cookbook module for local model installs
- Add task resume/replay with retry policy controls
- Add Pinokio package scripts for one-click local deployment