import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, FormEvent, ReactElement } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import * as THREE from "three";
import { MOUSE } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import dashboardLogo from "./assets/DashboardLogo_Nexus.png";

type PaneSelection = {
  type: "agent" | "tool";
  id: string;
};

type Harness = {
  id: string;
  name: string;
  endpoint: string;
  models: string[];
  defaultModel: string;
  status: "online" | "offline";
  health: "healthy" | "degraded" | "offline";
};

type Tool = {
  id: string;
  name: string;
  status: "online" | "offline" | "setup-required";
};

type Workspace = {
  id: string;
  name: string;
  path: string;
  sizeBytes: number;
  lastModified: string;
  activeHarnesses: string[];
};

type RouterProvider = {
  id: string;
  name: string;
  health: "healthy" | "degraded" | "offline";
  latencyMs: number;
};

type RouterLog = {
  timestamp: string;
  level: "info" | "warn" | "error";
  message: string;
};

type RouterSummary = {
  configured: boolean;
  baseUrl: string;
  defaultModel: string;
  fallbackOrder: string[];
  providers: RouterProvider[];
  logs: RouterLog[];
  maskedApiKey: string;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
};

type ChatMeta = {
  model: string;
  provider: string;
  fallbackUsed: boolean;
  elapsedMs: number;
  tokenUsage: {
    input: number;
    output: number;
  };
};

type HarnessChatThread = {
  id: string;
  title: string;
  messages: ChatMessage[];
  meta: ChatMeta | null;
  createdAt: string;
  updatedAt: string;
};

type HarnessSchedule = {
  id: string;
  harnessId: string;
  workspaceId: string;
  title: string;
  prompt: string;
  intervalMinutes: number;
  enabled: boolean;
  nextRunAt: string;
  lastRunAt?: string;
  createdAt: string;
  updatedAt: string;
};

type HarnessRunRecord = {
  id: string;
  harnessId: string;
  workspaceId: string;
  scheduleId?: string;
  trigger: "manual" | "scheduled";
  prompt: string;
  status: "completed" | "failed";
  output?: string;
  error?: string;
  model?: string;
  provider?: string;
  createdAt: string;
};

type HarnessSubTab = "chats" | "scheduled" | "runs";

type FailedTask = {
  requestId: string;
  harnessId: string;
  workspaceId: string;
  message: string;
  startedAt: string;
  updatedAt: string;
  status: "running" | "failed" | "completed" | "aborted";
  partialOutput: string;
  error?: string;
};

type StreamEnvelope =
  | { type: "meta"; meta: ChatMeta }
  | { type: "delta"; text: string }
  | { type: "done" }
  | { type: "error"; message: string };

type StartupReadiness = {
  ready: boolean;
  blockers: string[];
  onboardingComplete: boolean;
  liveHarnesses: number;
  totalHarnesses: number;
  checkedAt: string;
};

type BootstrapPayload = {
  appName: string;
  onboardingRequired: boolean;
  startupStrictMode?: boolean;
  selectedPane: PaneSelection;
  activeWorkspaceId: string;
  harnesses: Harness[];
  startup: StartupReadiness;
  tools: Tool[];
  router9: RouterSummary;
  workspaces: Workspace[];
};

type WorkspaceTreeNode = {
  name: string;
  type: "file" | "directory";
  path: string;
  children?: WorkspaceTreeNode[];
};

type WorkspaceFolderEntry = {
  name: string;
  path: string;
};

type CookbookRecommendation = {
  id: string;
  name: string;
  category: "coding" | "chat" | "voice" | "image" | "video";
  size: "small" | "medium" | "large";
  runtime: "ollama" | "llama.cpp" | "piper" | "wan2gp";
  summary: string;
  fitReason: string;
  installHint: string;
};

type CookbookSnapshot = {
  workspace: { id: string; path: string } | null;
  machine: {
    platform: string;
    arch: string;
    cpuModel: string;
    logicalCores: number;
    totalRamGb: number;
    freeRamGb: number;
    freeDiskGb: number | null;
    gpuNames: string[];
  };
  runtimes: {
    ollamaInstalled: boolean;
    piperInstalled: boolean;
  };
  installedModels: string[];
  recommendations: CookbookRecommendation[];
  scannedAt: string;
};

const RECOMMENDED_OLLAMA_MODELS: Record<string, string> = {
  "coding-qwen3-coder-30b": "qwen2.5-coder:32b",
  "coding-qwen2-5-coder-7b": "qwen2.5-coder:7b",
  "chat-llama3-2-3b": "llama3.2:3b",
};

type VoiceStatus = {
  piperInstalled: boolean;
  piperPath: string | null;
  browserSpeechRecommended: boolean;
  notes: string[];
  scannedAt: string;
};

type WhisperTranscriptionResult = {
  text: string;
  language?: string;
  provider: string;
  model: string;
};

type VoiceAssignmentsPayload = {
  voices: string[];
  harnesses: Array<{ id: string; name: string }>;
  assignments: Record<string, string>;
};

type RuntimeStatus = {
  ollamaInstalled: boolean;
  ollamaRunning: boolean;
  ollamaModels: string[];
  acejamInstalled: boolean;
  acejamRunning: boolean;
  acejamUrl: string;
  piperInstalled: boolean;
  piperPath: string | null;
  piperVoices: string[];
  defaultVoiceInstalled: boolean;
};

type ManagedHarnessRuntimeStatus = {
  harnessId: string;
  endpoint: string;
  mode: "managed" | "external" | "failed";
  detail: string;
};

type StartupCheckPayload = {
  startup: StartupReadiness;
  conformance: Array<{
    harnessId: string;
    harnessName: string;
    endpoint: string;
    timestamp: string;
    checks: Array<{ name: string; passed: boolean; details: string }>;
    score: { passed: number; total: number };
  }>;
  runtimeStatus?: RuntimeStatus;
  managedStatuses?: ManagedHarnessRuntimeStatus[];
  strictMode?: boolean;
  selfRepairReport?: {
    attempted: number;
    completed: number;
    failed: number;
    recent: Array<{ id: string; action: string; status: string; updatedAt: string; error?: string }>;
  };
};

type WebCapabilityDiagnostics = {
  probes: {
    crawl4ai: { available: boolean; command: string; details: string };
    officecli: { available: boolean; command: string; details: string };
  };
  harnessCapabilitySummary: Array<{
    harnessId: string;
    harnessName: string;
    fableModeEnabled: boolean;
    crawl4aiEnabled: boolean;
    officeCliEnabled: boolean;
    crawlAllowlistCount: number;
  }>;
  runtimeStatus: RuntimeStatus;
  managedStatuses: ManagedHarnessRuntimeStatus[];
  history?: {
    crawl4aiRuns: Array<{
      id: string;
      harnessId: string;
      url: string;
      domain: string;
      workspaceId: string;
      outputFile?: string;
      status: "success" | "failed";
      durationMs: number;
      checkedAt: string;
      error?: string;
    }>;
    officeCliRuns: Array<{
      id: string;
      harnessId: string;
      workspaceId: string;
      file: string;
      args: string[];
      preset?: string;
      status: "success" | "failed";
      durationMs: number;
      checkedAt: string;
      error?: string;
    }>;
  };
  policyWarnings?: string[];
  fableTelemetry?: Array<{ harnessId: string; profile: string; total: number; success: number; fallbackUsed: number }>;
  checkedAt: string;
};

type StableAudioStatus = {
  installed: boolean;
  running: boolean;
  ready: boolean;
  readyUrl: string | null;
  state: string;
  appId: string;
  ref: string | null;
  supportsMedium: boolean;
  modes: Array<{
    id: "small-music" | "small-sfx" | "medium";
    label: string;
    description: string;
    recommendedPrompt: string;
    available: boolean;
  }>;
};

type StableAudioGeneratedClip = {
  mode: "small-music" | "small-sfx" | "medium";
  duration: number;
  prompt: string;
  relativePath: string;
  playbackUrl: string;
};

type ImageGeneratedResult = {
  imageUrl: string;
  prompt: string;
  provider: string;
  model: string;
  width: number;
  height: number;
  steps?: number;
  seed?: number;
  profile?: number;
  negativePrompt?: string;
  createdAt: string;
  relativePath?: string;
};

type VideoGeneratedResult = {
  videoUrl: string;
  prompt: string;
  provider: string;
  model: string;
  width: number;
  height: number;
  steps?: number;
  seed?: number;
  profile?: number;
  durationSeconds?: number;
  fps?: number;
  frameCount?: number;
  negativePrompt?: string;
  createdAt: string;
  relativePath?: string;
};

type Wan2GpStatus = {
  installed: boolean;
  envReady: boolean;
  apiReady: boolean;
  appRoot: string;
  pythonPath: string | null;
  supports: {
    image: boolean;
    video: boolean;
    tts: boolean;
    stt: boolean;
  };
  notes: string[];
  machine: {
    logicalCores: number;
    totalRamGb: number;
    recommendedProfile: number;
  };
  recommended: {
    profile: number;
    image: {
      model: string;
      width: number;
      height: number;
      steps: number;
    };
    video: {
      model: string;
      width: number;
      height: number;
      steps: number;
      durationSeconds: number;
      fps: number;
      frameCount: number;
    };
  };
  modelHints: {
    image: string[];
    video: string[];
  };
  modelCatalog?: {
    image: Array<{ modelType: string; available: boolean; status: string }>;
    video: Array<{ modelType: string; available: boolean; status: string }>;
    scannedAt: string;
  };
};

type LocalImageStreamEnvelope =
  | { type: "status"; message: string }
  | {
    type: "done";
    result: {
      imageUrl: string;
      relativePath: string;
      workspaceId: string;
      provider: string;
      model: string;
      width: number;
      height: number;
      steps: number;
      seed: number;
      profile: number;
      prompt: string;
      negativePrompt: string;
    };
  }
  | { type: "error"; message: string };

type Wan2GpVideoStreamEnvelope =
  | { type: "status"; message: string }
  | {
    type: "done";
    result: {
      videoUrl: string;
      relativePath: string;
      workspaceId: string;
      provider: string;
      model: string;
      width: number;
      height: number;
      steps: number;
      seed: number;
      profile: number;
      durationSeconds?: number;
      fps?: number;
      frameCount?: number;
      prompt: string;
      negativePrompt: string;
    };
  }
  | { type: "error"; message: string };

type Hunyuan3dStatus = {
  installed: boolean;
  envReady: boolean;
  apiReady: boolean;
  appRoot: string;
  pythonPath: string | null;
  notes: string[];
  recommended: {
    modelPath: string;
    subfolder: string;
    numInferenceSteps: number;
    octreeResolution: number;
    guidanceScale: number;
  };
};

type Hunyuan3dStreamEnvelope =
  | { type: "status"; message: string }
  | {
    type: "done";
    result: {
      modelUrl: string;
      relativePath: string;
      workspaceId: string;
      provider: string;
      modelPath: string;
      subfolder: string;
      numInferenceSteps: number;
      octreeResolution: number;
      guidanceScale: number;
      seed: number;
      format: "glb" | "obj";
      device: string;
      sourceKind: "image" | "text";
      sourceImageUrl: string;
    };
  }
  | { type: "error"; message: string };

type Model3dGeneratedResult = {
  modelUrl: string;
  provider: string;
  modelPath: string;
  subfolder: string;
  numInferenceSteps: number;
  octreeResolution: number;
  guidanceScale: number;
  seed: number;
  format: "glb" | "obj";
  device: string;
  sourceKind: "image" | "text";
  sourceImageUrl: string;
  createdAt: string;
  relativePath?: string;
};

type ImageSizePreset = {
  id: string;
  label: string;
  width: number;
  height: number;
};

type RuntimeJob = {
  id: string;
  action: "install-ollama" | "start-ollama" | "pull-ollama-model" | "install-piper" | "install-default-piper-voice" | "install-acejam" | "start-acejam" | "install-wan2gp" | "start-wan2gp" | "install-hunyuan3d" | "start-hunyuan3d";
  model?: string;
  status: "queued" | "running" | "canceling" | "completed" | "failed" | "canceled";
  createdAt: string;
  updatedAt: string;
  finishedAt?: string;
  logs: string[];
  error?: string;
  retryOfId?: string;
};

type ThemePreset = {
  id: string;
  name: string;
  hint: string;
};

type GitStatusPayload = {
  branch: string;
  ahead: number;
  behind: number;
  clean: boolean;
  counts: {
    staged: number;
    unstaged: number;
    untracked: number;
    total: number;
  };
  entries: Array<{ x: string; y: string; path: string }>;
  remotes: string[];
  rootDir: string;
};

type GitHubConnectorStatus = {
  connected: boolean;
  login: string | null;
  maskedToken: string | null;
  scopes: string[];
  connectedAt: string | null;
  lastVerifiedAt: string | null;
};

type GitHubDeviceFlow = {
  clientId: string;
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string;
  interval: number;
  expiresAt: number;
  scopes: string[];
};

type SettingsTab = "connectors" | "appearance" | "automation";

type MediaCenterTab = "voice" | "music" | "image" | "video" | "models";

type ConnectorCard = {
  id: "github" | "gmail" | "slack" | "discord" | "notion" | "dropbox";
  name: string;
  connected: boolean;
  kind: "oauth" | "token" | "placeholder";
};

// ── Nexus Router types ──────────────────────────────────────────────────────
type NxProvider = {
  id: string;
  name: string;
  type: "openai-compatible" | "openrouter";
  baseUrl: string;
  enabled: boolean;
  defaultModel?: string;
  models?: string[];
  lastSyncedAt?: string;
  maskedApiKey: string;
};

type NxProviderView = {
  id: string;
  name: string;
  enabled: boolean;
  models: string[];
  baseUrl?: string;
  lastSyncedAt?: string;
  maskedApiKey: string;
  isLocal?: boolean;
};

type NxFallbackTarget = { providerId: string; model: string };

type NxRetryPolicy = {
  maxAttempts: number;
  backoffMs: number;
  retryOnStatus: number[];
};

type NxRouterConfig = {
  fallbackChain: NxFallbackTarget[];
  harnessAssignments: Record<string, NxFallbackTarget[]>;
  retryPolicy: NxRetryPolicy;
  logs: Array<{ timestamp: string; level: string; message: string }>;
};

type NxFallbackRow = {
  id: string;
  providerId: string;
  model: string;
};

type ProviderCatalogEntry = {
  id: string;
  name: string;
  type: NxProvider["type"];
  baseUrl: string;
  defaultModel: string;
  tier: "free" | "paid" | "mixed";
  healthScore: number;
  quotaNotes: string;
  rateLimitNotes: string;
  tags: string[];
  notes: string;
};

type HarnessCapabilitySettings = {
  fableMode: {
    enabled: boolean;
    profile: "off" | "balanced" | "strict";
  };
  openDesign: {
    enabled: boolean;
  };
  crawl4ai: {
    enabled: boolean;
    allowedDomains: string[];
    allowExternalDomains: boolean;
    obeyRobotsTxt: boolean;
    maxPages: number;
    timeoutMs: number;
  };
  officeCli: {
    enabled: boolean;
    allowedExtensions: string[];
    maxFileSizeMb: number;
  };
};

const DEFAULT_PROVIDER_PRESETS: ProviderCatalogEntry[] = [
  { id: "openrouter", name: "OpenRouter", type: "openrouter", baseUrl: "https://openrouter.ai/api/v1", defaultModel: "openai/gpt-4.1-mini", tier: "mixed", tags: ["multi-provider"], notes: "Large model marketplace." },
  { id: "openai", name: "OpenAI", type: "openai-compatible", baseUrl: "https://api.openai.com/v1", defaultModel: "gpt-4.1-mini", tier: "paid", tags: ["reliable"], notes: "Direct OpenAI endpoint." },
  { id: "iflow", name: "iFlow AI (free)", type: "openai-compatible", baseUrl: "http://localhost:20128/v1", defaultModel: "iflow/default", tier: "free", tags: ["local-gateway"], notes: "Local free profile." },
  { id: "qwencode", name: "Qwen Code (free)", type: "openai-compatible", baseUrl: "http://localhost:20128/v1", defaultModel: "qwencode/default", tier: "free", tags: ["coding"], notes: "Local coding profile." },
  { id: "gemini-cli", name: "Gemini CLI (free)", type: "openai-compatible", baseUrl: "http://localhost:20128/v1", defaultModel: "gemini-cli/default", tier: "free", tags: ["general"], notes: "Local Gemini profile." },
  { id: "kiro-ai", name: "Kiro AI (free)", type: "openai-compatible", baseUrl: "http://localhost:20128/v1", defaultModel: "kiro-ai/default", tier: "free", tags: ["assistant"], notes: "Local assistant profile." },
  { id: "anthropic-compat", name: "Anthropic (via OpenRouter)", type: "openrouter", baseUrl: "https://openrouter.ai/api/v1", defaultModel: "anthropic/claude-sonnet-4-5", tier: "paid", tags: ["claude"], notes: "Anthropic via OpenRouter." },
  { id: "together", name: "Together AI", type: "openai-compatible", baseUrl: "https://api.together.xyz/v1", defaultModel: "meta-llama/Llama-3-8b-chat-hf", tier: "mixed", tags: ["open-models"], notes: "Open model API." },
  { id: "groq", name: "Groq", type: "openai-compatible", baseUrl: "https://api.groq.com/openai/v1", defaultModel: "llama3-8b-8192", tier: "mixed", tags: ["low-latency"], notes: "Fast inference endpoint." },
  { id: "custom", name: "Custom / Local", type: "openai-compatible", baseUrl: "http://localhost:11434/v1", defaultModel: "llama3", tier: "free", tags: ["self-hosted"], notes: "Bring your own endpoint." },
].map((entry) => ({
  ...entry,
  type: entry.type as NxProvider["type"],
  tier: entry.tier as "free" | "paid" | "mixed",
  healthScore: entry.tier === "paid" ? 90 : entry.tier === "mixed" ? 82 : 74,
  quotaNotes: entry.tier === "free" ? "Free usage can be volatile; keep fallback rows ready." : "Check account quotas and spend caps.",
  rateLimitNotes: "Provider-side rate limits may apply based on RPM/TPM and account tier.",
}));

const PROVIDER_API_KEY_LINKS: Record<string, string> = {
  openrouter: "https://openrouter.ai/keys",
  openai: "https://platform.openai.com/api-keys",
  anthropic: "https://console.anthropic.com/settings/keys",
  together: "https://api.together.xyz/settings/api-keys",
  groq: "https://console.groq.com/keys",
  deepseek: "https://platform.deepseek.com/api_keys",
  mistral: "https://console.mistral.ai/api-keys",
  xai: "https://console.x.ai/team/api-keys",
  fireworks: "https://fireworks.ai/account/api-keys",
  google: "https://aistudio.google.com/app/apikey",
};

const THEME_PRESETS: ThemePreset[] = [
  { id: "ember", name: "Ember Ops", hint: "default warm cyber theme" },
  { id: "daybreak", name: "Daybreak Light", hint: "clean bright workspace mode" },
  { id: "ocean", name: "Ocean Grid", hint: "cool steel + cyan accents" },
  { id: "forest", name: "Forest Signal", hint: "green tactical terminal tone" },
  { id: "sunset", name: "Sunset Neon", hint: "gold + coral high contrast" },
];

const IMAGE_SIZE_PRESETS: ImageSizePreset[] = [
  { id: "square", label: "Square 512", width: 512, height: 512 },
  { id: "portrait", label: "Portrait 512x768", width: 512, height: 768 },
  { id: "landscape", label: "Landscape 768x512", width: 768, height: 512 },
  { id: "thumbnail", label: "Thumbnail 640x384", width: 640, height: 384 },
];

function disposeObject3d(root: THREE.Object3D): void {
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (mesh.geometry && "dispose" in mesh.geometry) {
      mesh.geometry.dispose();
    }
    const material = (mesh as { material?: THREE.Material | THREE.Material[] }).material;
    if (Array.isArray(material)) {
      material.forEach((entry) => entry.dispose());
    } else {
      material?.dispose();
    }
  });
}

function Model3dViewport(props: { modelUrl: string; format: "glb" | "obj" }): ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    let disposed = false;
    let animationFrame = 0;
    let loadedModel: THREE.Object3D | null = null;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#0c1419");

    const camera = new THREE.PerspectiveCamera(46, 1, 0.01, 2000);
    camera.position.set(0, 1, 2.8);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    container.innerHTML = "";
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.screenSpacePanning = true;
    controls.mouseButtons.LEFT = MOUSE.PAN;
    controls.mouseButtons.RIGHT = MOUSE.ROTATE;
    controls.mouseButtons.MIDDLE = MOUSE.DOLLY;

    const hemi = new THREE.HemisphereLight("#ffe9cc", "#305070", 1.1);
    const key = new THREE.DirectionalLight("#ffffff", 1.25);
    key.position.set(4, 7, 4);
    const fill = new THREE.DirectionalLight("#99ccff", 0.65);
    fill.position.set(-4, 3, -3);
    scene.add(hemi, key, fill);

    const grid = new THREE.GridHelper(14, 20, "#3f6a7a", "#25414c");
    grid.position.y = -0.001;
    scene.add(grid);

    const frameScene = (object: THREE.Object3D) => {
      const box = new THREE.Box3().setFromObject(object);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const radius = Math.max(size.x, size.y, size.z) * 0.65;
      const safeRadius = Number.isFinite(radius) && radius > 0 ? radius : 1;

      controls.target.copy(center);
      camera.position.set(center.x + safeRadius * 1.6, center.y + safeRadius * 0.9, center.z + safeRadius * 1.9);
      camera.near = Math.max(0.01, safeRadius / 400);
      camera.far = Math.max(120, safeRadius * 80);
      camera.updateProjectionMatrix();
      controls.update();
    };

    const applySize = () => {
      const width = Math.max(200, Math.floor(container.clientWidth));
      const height = Math.max(220, Math.floor(container.clientHeight));
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };

    applySize();
    const observer = new ResizeObserver(() => applySize());
    observer.observe(container);

    const animate = () => {
      if (disposed) {
        return;
      }
      controls.update();
      renderer.render(scene, camera);
      animationFrame = window.requestAnimationFrame(animate);
    };

    const loadModel = async () => {
      setLoadError(null);
      try {
        let rootObject: THREE.Object3D;
        if (props.format === "glb") {
          const loader = new GLTFLoader();
          const gltf = await loader.loadAsync(props.modelUrl);
          rootObject = gltf.scene;
        } else {
          const loader = new OBJLoader();
          rootObject = await loader.loadAsync(props.modelUrl);
        }

        if (disposed) {
          disposeObject3d(rootObject);
          return;
        }

        loadedModel = rootObject;
        scene.add(rootObject);
        frameScene(rootObject);
      } catch (error) {
        if (!disposed) {
          setLoadError(String(error));
        }
      }
    };

    void loadModel();
    animate();

    return () => {
      disposed = true;
      observer.disconnect();
      window.cancelAnimationFrame(animationFrame);
      controls.dispose();
      if (loadedModel) {
        scene.remove(loadedModel);
        disposeObject3d(loadedModel);
      }
      renderer.dispose();
      container.innerHTML = "";
    };
  }, [props.format, props.modelUrl]);

  return (
    <div className="model3d-viewport-shell">
      <div className="model3d-viewport-canvas" ref={containerRef} />
      <small>Controls: left drag = pan camera, right drag = orbit model, wheel = zoom.</small>
      {loadError ? <small className="model3d-viewport-error">Preview load failed: {loadError}</small> : null}
    </div>
  );
}

function App() {
  const [themeId, setThemeId] = useState<string>(() => {
    if (typeof window === "undefined") {
      return "ember";
    }
    return window.localStorage.getItem("nexus-theme") || "ember";
  });
  const [boot, setBoot] = useState<BootstrapPayload | null>(null);
  const [selectedPane, setSelectedPane] = useState<PaneSelection>({ type: "tool", id: "nexus-router" });
  const [composer, setComposer] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);
  const [chatThreadsByHarness, setChatThreadsByHarness] = useState<Record<string, HarnessChatThread[]>>({});
  const [activeThreadByHarness, setActiveThreadByHarness] = useState<Record<string, string>>({});
  const [harnessSubTabByHarness, setHarnessSubTabByHarness] = useState<Record<string, HarnessSubTab>>({});
  const [harnessSchedulesByHarness, setHarnessSchedulesByHarness] = useState<Record<string, HarnessSchedule[]>>({});
  const [harnessRunsByHarness, setHarnessRunsByHarness] = useState<Record<string, HarnessRunRecord[]>>({});
  const [scheduleDraftByHarness, setScheduleDraftByHarness] = useState<Record<string, { title: string; prompt: string; intervalMinutes: number }>>({});
  const [scheduleBusyHarnessId, setScheduleBusyHarnessId] = useState<string | null>(null);
  const [manualRunBusyHarnessId, setManualRunBusyHarnessId] = useState<string | null>(null);
  const [editingScheduleIdByHarness, setEditingScheduleIdByHarness] = useState<Record<string, string | null>>({});
  const [workspaceTree, setWorkspaceTree] = useState<WorkspaceTreeNode | null>(null);
  const [failedTasks, setFailedTasks] = useState<FailedTask[]>([]);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [resumeBusyId, setResumeBusyId] = useState<string | null>(null);
  const [createWorkspaceName, setCreateWorkspaceName] = useState("");
  const [workspacePathDraft, setWorkspacePathDraft] = useState<string>("");
  const [workspaceBrowserOpen, setWorkspaceBrowserOpen] = useState(false);
  const [workspaceRoots, setWorkspaceRoots] = useState<string[]>([]);
  const [workspaceBrowsePath, setWorkspaceBrowsePath] = useState<string>("");
  const [workspaceBrowseParentPath, setWorkspaceBrowseParentPath] = useState<string | null>(null);
  const [workspaceBrowseFolders, setWorkspaceBrowseFolders] = useState<WorkspaceFolderEntry[]>([]);
  const [workspaceBrowseBusy, setWorkspaceBrowseBusy] = useState(false);
  const [cookbookSnapshot, setCookbookSnapshot] = useState<CookbookSnapshot | null>(null);
  const [cookbookBusy, setCookbookBusy] = useState(false);
  const [cookbookRouterHandoffBusy, setCookbookRouterHandoffBusy] = useState(false);
  const [cookbookTab, setCookbookTab] = useState<"overview" | "jobs">("overview");
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus | null>(null);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [voiceText, setVoiceText] = useState("Nexus OS voice check. This is your text to speech tool.");
  const [voicePlaying, setVoicePlaying] = useState(false);
  const [voiceRecording, setVoiceRecording] = useState(false);
  const [voiceTranscribing, setVoiceTranscribing] = useState(false);
  const [voicePreviewVoiceId, setVoicePreviewVoiceId] = useState<string>("");
  const [voiceAvailableVoices, setVoiceAvailableVoices] = useState<string[]>([]);
  const [voiceAssignments, setVoiceAssignments] = useState<Record<string, string>>({});
  const [voiceAssignmentsBusy, setVoiceAssignmentsBusy] = useState(false);
  const [voiceSaveBusy, setVoiceSaveBusy] = useState(false);
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus | null>(null);
  const [runtimeBusyAction, setRuntimeBusyAction] = useState<string | null>(null);
  const [runtimeJobs, setRuntimeJobs] = useState<RuntimeJob[]>([]);
  const [expandedRuntimeJobIds, setExpandedRuntimeJobIds] = useState<Record<string, boolean>>({});
  const [stableAudioStatus, setStableAudioStatus] = useState<StableAudioStatus | null>(null);
  const [stableAudioBusyAction, setStableAudioBusyAction] = useState<"refresh" | "generate" | null>(null);
  const [stableAudioMode, setStableAudioMode] = useState<"small-music" | "small-sfx" | "medium">("small-music");
  const [stableAudioPrompt, setStableAudioPrompt] = useState("lo-fi hip hop beat, 90 BPM");
  const [stableAudioDuration, setStableAudioDuration] = useState(30);
  const [stableAudioGenerated, setStableAudioGenerated] = useState<StableAudioGeneratedClip[]>([]);
  const [imagePrompt, setImagePrompt] = useState("pixel-art hero sprite sheet, transparent background, game-ready");
  const [imageNegativePrompt, setImageNegativePrompt] = useState("blurry, low quality, watermark, text");
  const [imageModel, setImageModel] = useState("auto");
  const [imageWidth, setImageWidth] = useState(768);
  const [imageHeight, setImageHeight] = useState(768);
  const [imageSteps, setImageSteps] = useState(6);
  const [wanProfile, setWanProfile] = useState(4);
  const [imageSeed, setImageSeed] = useState(-1);
  const [imageBusyAction, setImageBusyAction] = useState<"generate" | "save" | null>(null);
  const [imageResult, setImageResult] = useState<ImageGeneratedResult | null>(null);
  const [recentImages, setRecentImages] = useState<ImageGeneratedResult[]>([]);
  const [imageStatusTrace, setImageStatusTrace] = useState("");
  const [wan2GpStatus, setWan2GpStatus] = useState<Wan2GpStatus | null>(null);
  const imageGenerationAbortRef = useRef<AbortController | null>(null);
  const [videoPrompt, setVideoPrompt] = useState("cinematic flythrough of a neon city at dusk, volumetric fog, smooth camera");
  const [videoNegativePrompt, setVideoNegativePrompt] = useState("blurry, flicker, low quality, artifacts, text watermark");
  const [videoModel, setVideoModel] = useState("auto");
  const [videoWidth, setVideoWidth] = useState(640);
  const [videoHeight, setVideoHeight] = useState(384);
  const [videoSteps, setVideoSteps] = useState(6);
  const [videoDurationSeconds, setVideoDurationSeconds] = useState(3);
  const [videoFps, setVideoFps] = useState(16);
  const [videoFrameCount, setVideoFrameCount] = useState(49);
  const [videoSeed, setVideoSeed] = useState(-1);
  const [videoBusyAction, setVideoBusyAction] = useState<"generate" | null>(null);
  const [videoStatusTrace, setVideoStatusTrace] = useState("");
  const [videoResult, setVideoResult] = useState<VideoGeneratedResult | null>(null);
  const [recentVideos, setRecentVideos] = useState<VideoGeneratedResult[]>([]);
  const videoGenerationAbortRef = useRef<AbortController | null>(null);
  const [hunyuan3dStatus, setHunyuan3dStatus] = useState<Hunyuan3dStatus | null>(null);
  const [model3dInputMode, setModel3dInputMode] = useState<"image" | "text">("image");
  const [model3dSourceImageUrl, setModel3dSourceImageUrl] = useState("");
  const [model3dSourceImageBase64, setModel3dSourceImageBase64] = useState("");
  const [model3dSourceImageFileName, setModel3dSourceImageFileName] = useState("");
  const [model3dSourceImageMime, setModel3dSourceImageMime] = useState("image/png");
  const [model3dTextPrompt, setModel3dTextPrompt] = useState("");
  const [model3dTextNegativePrompt, setModel3dTextNegativePrompt] = useState("blurry, noisy, low quality, text watermark");
  const [model3dTextImageModel, setModel3dTextImageModel] = useState("auto");
  const [model3dTextImageWidth, setModel3dTextImageWidth] = useState(768);
  const [model3dTextImageHeight, setModel3dTextImageHeight] = useState(768);
  const [model3dTextImageSteps, setModel3dTextImageSteps] = useState(6);
  const [model3dTextImageProfile, setModel3dTextImageProfile] = useState(4);
  const [model3dTextImageSeed, setModel3dTextImageSeed] = useState(-1);
  const [model3dModelPath, setModel3dModelPath] = useState("tencent/Hunyuan3D-2mini");
  const [model3dSubfolder, setModel3dSubfolder] = useState("hunyuan3d-dit-v2-mini-turbo");
  const [model3dNumInferenceSteps, setModel3dNumInferenceSteps] = useState(20);
  const [model3dOctreeResolution, setModel3dOctreeResolution] = useState(192);
  const [model3dGuidanceScale, setModel3dGuidanceScale] = useState(5);
  const [model3dSeed, setModel3dSeed] = useState(-1);
  const [model3dFormat, setModel3dFormat] = useState<"glb" | "obj">("glb");
  const [model3dBusyAction, setModel3dBusyAction] = useState<"generate" | null>(null);
  const [model3dStatusTrace, setModel3dStatusTrace] = useState("");
  const [model3dResult, setModel3dResult] = useState<Model3dGeneratedResult | null>(null);
  const [recentModels3d, setRecentModels3d] = useState<Model3dGeneratedResult[]>([]);
  const model3dGenerationAbortRef = useRef<AbortController | null>(null);
  const [statusMessage, setStatusMessage] = useState("Booting NEXUS OS...");
  const [toasts, setToasts] = useState<Array<{ id: string; message: string; tone: "ok" | "warn" | "err" }>>([]);
  const [toolsOpen, setToolsOpen] = useState(true);
  const [gitStatus, setGitStatus] = useState<GitStatusPayload | null>(null);
  const [gitBusyAction, setGitBusyAction] = useState<"refresh" | "commit" | "push" | null>(null);
  const [gitCommitMessage, setGitCommitMessage] = useState("Update NexusOS workspace changes");
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("connectors");
  const [mediaCenterTab, setMediaCenterTab] = useState<MediaCenterTab>("voice");
  const [activeConnectorId, setActiveConnectorId] = useState<ConnectorCard["id"] | null>(null);
  const [githubConnector, setGithubConnector] = useState<GitHubConnectorStatus | null>(null);
  const [githubClientId, setGithubClientId] = useState<string>(() => {
    if (typeof window === "undefined") {
      return "";
    }
    return window.localStorage.getItem("nexus-github-client-id") ?? "";
  });
  const [githubTokenDraft, setGithubTokenDraft] = useState("");
  const [githubDeviceFlow, setGithubDeviceFlow] = useState<GitHubDeviceFlow | null>(null);
  const [githubBusy, setGithubBusy] = useState<"connect" | "disconnect" | "refresh" | "device-start" | "device-poll" | null>(null);
  const [githubInlineError, setGithubInlineError] = useState<string | null>(null);
  const [nxConfigSaving, setNxConfigSaving] = useState(false);
  const [startupChecking, setStartupChecking] = useState(false);
  const [startupStrictMode, setStartupStrictMode] = useState(false);
  const [startupStrictModeSaving, setStartupStrictModeSaving] = useState(false);
  const [lastStartupCheck, setLastStartupCheck] = useState<{ readiness: StartupReadiness; timestamp: string } | null>(null);
  const [startupCheckDetails, setStartupCheckDetails] = useState<StartupCheckPayload | null>(null);
  const [webCapabilityDiagnostics, setWebCapabilityDiagnostics] = useState<WebCapabilityDiagnostics | null>(null);
  const [webCapabilityDiagnosticsBusy, setWebCapabilityDiagnosticsBusy] = useState(false);
  const [officePresets, setOfficePresets] = useState<Array<{ id: string; label: string; description: string; args: string[] }>>([]);
  const [officePresetDraft, setOfficePresetDraft] = useState<{ harnessId: string; preset: "view" | "validate" | "create"; file: string; kind: "docx" | "xlsx" | "pptx" }>({ harnessId: "", preset: "view", file: "", kind: "docx" });
  const [officePresetBusy, setOfficePresetBusy] = useState(false);
  const [rightTab, setRightTab] = useState<"workspace" | "diagnostics">("workspace");
  const [streamTrace, setStreamTrace] = useState("");
  const [streamTraceOpen, setStreamTraceOpen] = useState(false);
  const [autoSpeakHarnessReplies, setAutoSpeakHarnessReplies] = useState(true);
  const [harnessSpeaking, setHarnessSpeaking] = useState(false);
  const harnessSpeechAudioRef = useRef<HTMLAudioElement | null>(null);
  const harnessSpeechUrlRef = useRef<string | null>(null);
  const voiceRecorderRef = useRef<MediaRecorder | null>(null);
  const voiceRecordingChunksRef = useRef<Blob[]>([]);

  const model3dSourcePreviewUrl = useMemo(() => {
    if (model3dSourceImageBase64.trim()) {
      const mime = model3dSourceImageMime.trim() || "image/png";
      return `data:${mime};base64,${model3dSourceImageBase64.trim()}`;
    }

    const candidate = model3dSourceImageUrl.trim();
    if (!candidate) {
      return "";
    }

    if (/^https?:\/\//i.test(candidate) || candidate.startsWith("/api/") || candidate.startsWith("data:image/")) {
      return candidate;
    }

    return "";
  }, [model3dSourceImageBase64, model3dSourceImageMime, model3dSourceImageUrl]);
  
  async function loadCookbookSnapshot() {
    setCookbookBusy(true);
    try {
      const response = await fetch("/api/tools/cookbook/scan");
      if (!response.ok) {
        setStatusMessage("Failed to scan machine for cookbook recommendations");
        return;
      }
      const payload = (await response.json()) as CookbookSnapshot;
      setCookbookSnapshot(payload);
    } finally {
      setCookbookBusy(false);
    }
  }

  async function loadRuntimeJobs() {
    const response = await fetch("/api/tools/runtimes/jobs");
    if (!response.ok) {
      return;
    }
    const payload = (await response.json()) as { jobs: RuntimeJob[] };
    setRuntimeJobs(payload.jobs ?? []);
  }

  async function loadRuntimeStatus() {
    const response = await fetch("/api/tools/runtimes/status");
    if (!response.ok) {
      return;
    }
    const payload = (await response.json()) as RuntimeStatus;
    setRuntimeStatus(payload);
  }
  
  async function loadVoiceStatus() {
    setVoiceBusy(true);
    const response = await fetch("/api/tools/voice/status");
    if (!response.ok) {
      setVoiceBusy(false);
      setStatusMessage("Failed to load voice tool status");
      return;
    }
    const payload = (await response.json()) as VoiceStatus;
    setVoiceStatus(payload);
    await loadVoiceAssignments();
    await loadRuntimeStatus();
    setVoiceBusy(false);
  }

  async function loadVoiceAssignments() {
    const response = await fetch("/api/tools/voice/assignments");
    if (!response.ok) {
      return;
    }
    const payload = (await response.json()) as VoiceAssignmentsPayload;
    setVoiceAvailableVoices(payload.voices ?? []);
    setVoiceAssignments(payload.assignments ?? {});
    if (!voicePreviewVoiceId && (payload.voices?.length ?? 0) > 0) {
      setVoicePreviewVoiceId(payload.voices[0]);
    }
  }

  function blobToBase64(blob: Blob): Promise<{ audioBase64: string; mimeType: string }> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Failed to read microphone recording."));
      reader.onload = () => {
        const result = String(reader.result ?? "");
        const match = result.match(/^data:([^;]+);base64,(.+)$/);
        if (!match) {
          reject(new Error("Unexpected microphone recording format."));
          return;
        }
        resolve({ audioBase64: match[2], mimeType: match[1] });
      };
      reader.readAsDataURL(blob);
    });
  }

  async function transcribeVoiceRecording(blob: Blob) {
    setVoiceTranscribing(true);
    try {
      const payload = await blobToBase64(blob);
      const response = await fetch("/api/tools/voice/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorPayload = (await response.json()) as { error?: string };
        setStatusMessage(errorPayload.error ?? "Mic transcription failed.");
        return;
      }

      const transcription = (await response.json()) as WhisperTranscriptionResult;
      setVoiceText((current) => {
        const next = current.trimEnd();
        return next.length > 0 ? `${next} ${transcription.text}` : transcription.text;
      });
      setStatusMessage(`Whisper transcribed ${transcription.language ? `${transcription.language} ` : ""}audio.`);
    } catch (error) {
      setStatusMessage(String(error));
    } finally {
      setVoiceTranscribing(false);
    }
  }

  async function startVoiceRecording() {
    if (voiceRecording || voiceTranscribing) {
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatusMessage("This browser does not support microphone recording.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      voiceRecordingChunksRef.current = [];
      voiceRecorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          voiceRecordingChunksRef.current.push(event.data);
        }
      };
      recorder.onstop = () => {
        const chunks = voiceRecordingChunksRef.current;
        voiceRecordingChunksRef.current = [];
        voiceRecorderRef.current = null;
        stream.getTracks().forEach((track) => track.stop());
        if (chunks.length > 0) {
          void transcribeVoiceRecording(new Blob(chunks, { type: recorder.mimeType || "audio/webm" }));
        }
      };
      recorder.start();
      setVoiceRecording(true);
      setStatusMessage("Recording microphone for Whisper transcription...");
    } catch (error) {
      setStatusMessage(String(error));
    }
  }

  function stopVoiceRecording() {
    const recorder = voiceRecorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      setVoiceRecording(false);
      return;
    }
    recorder.stop();
    setVoiceRecording(false);
  }

  function stopHarnessSpeech() {
    const activeAudio = harnessSpeechAudioRef.current;
    if (activeAudio) {
      activeAudio.pause();
      activeAudio.currentTime = 0;
      harnessSpeechAudioRef.current = null;
    }
    if (harnessSpeechUrlRef.current) {
      URL.revokeObjectURL(harnessSpeechUrlRef.current);
      harnessSpeechUrlRef.current = null;
    }
    setHarnessSpeaking(false);
  }

  async function playAudioPayload(payload: { audioBase64: string; mimeType: string }, trackAsHarnessSpeech = false) {
    const byteChars = atob(payload.audioBase64);
    const bytes = new Uint8Array(byteChars.length);
    for (let index = 0; index < byteChars.length; index += 1) {
      bytes[index] = byteChars.charCodeAt(index);
    }
    const blob = new Blob([bytes], { type: payload.mimeType });
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);

    if (trackAsHarnessSpeech) {
      stopHarnessSpeech();
      harnessSpeechAudioRef.current = audio;
      harnessSpeechUrlRef.current = url;
      setHarnessSpeaking(true);
    }

    await new Promise<void>((resolve) => {
      audio.onended = () => {
        URL.revokeObjectURL(url);
        if (trackAsHarnessSpeech) {
          harnessSpeechAudioRef.current = null;
          harnessSpeechUrlRef.current = null;
          setHarnessSpeaking(false);
        }
        resolve();
      };
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        if (trackAsHarnessSpeech) {
          harnessSpeechAudioRef.current = null;
          harnessSpeechUrlRef.current = null;
          setHarnessSpeaking(false);
        }
        resolve();
      };
      void audio.play().catch(() => {
        URL.revokeObjectURL(url);
        if (trackAsHarnessSpeech) {
          harnessSpeechAudioRef.current = null;
          harnessSpeechUrlRef.current = null;
          setHarnessSpeaking(false);
        }
        resolve();
      });
    });
  }

  async function speakHarnessReplyIfAssigned(harnessId: string, text: string) {
    if (!autoSpeakHarnessReplies) {
      return;
    }

    const voiceId = voiceAssignments[harnessId];
    if (!voiceId || !text.trim()) {
      return;
    }

    const response = await fetch("/api/tools/voice/speak", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: text.trim(), voiceId }),
    });

    if (!response.ok) {
      const payload = (await response.json()) as { error?: string };
      setStatusMessage(payload.error ?? "Assigned harness voice playback failed.");
      return;
    }

    const payload = (await response.json()) as { audioBase64: string; mimeType: string };
    await playAudioPayload(payload, true);
  }

  async function saveVoiceAssignments(next: Record<string, string>) {
    setVoiceAssignmentsBusy(true);
    const response = await fetch("/api/tools/voice/assignments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assignments: next }),
    });

    if (!response.ok) {
      const payload = (await response.json()) as { error?: string };
      setStatusMessage(payload.error ?? "Failed to save voice assignments.");
      setVoiceAssignmentsBusy(false);
      return;
    }

    setVoiceAssignments(next);
    setVoiceAssignmentsBusy(false);
    setStatusMessage("Harness voice assignments saved.");
  }

  async function waitForRuntimeJobCompletion(jobId: string, successMessage: string): Promise<{ ok: boolean; error?: string }> {
    while (true) {
      const poll = await fetch(`/api/tools/runtimes/jobs/${encodeURIComponent(jobId)}`);
      if (!poll.ok) {
        setStatusMessage("Runtime job disappeared before completion.");
        setRuntimeBusyAction(null);
        return { ok: false, error: "Runtime job disappeared before completion." };
      }

      const pollPayload = (await poll.json()) as { job: RuntimeJob };
      const job = pollPayload.job;
      await loadRuntimeJobs();

      if (job.status === "completed") {
        await Promise.all([loadRuntimeStatus(), loadCookbookSnapshot(), loadVoiceStatus(), loadRuntimeJobs()]);
        setStatusMessage(successMessage);
        setRuntimeBusyAction(null);
        return { ok: true };
      }

      if (job.status === "failed") {
        const failureMessage = job.error ?? job.logs[job.logs.length - 1] ?? "Runtime job failed";
        setStatusMessage(failureMessage);
        setRuntimeBusyAction(null);
        return { ok: false, error: failureMessage };
      }

      if (job.status === "canceled") {
        setStatusMessage("Runtime job canceled.");
        setRuntimeBusyAction(null);
        return { ok: false, error: "Runtime job canceled." };
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  async function runRuntimeJob(actionId: string, action: RuntimeJob["action"], successMessage: string, model?: string): Promise<{ ok: boolean; error?: string }> {
    setRuntimeBusyAction(actionId);
    const response = await fetch("/api/tools/runtimes/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, model }),
    });

    if (!response.ok) {
      const payload = (await response.json()) as { error?: string };
      setStatusMessage(payload.error ?? "Runtime job failed to start");
      setRuntimeBusyAction(null);
      return { ok: false, error: payload.error ?? "Runtime job failed to start" };
    }

    const payload = (await response.json()) as { job: RuntimeJob };
    const jobId = payload.job.id;
    setStatusMessage(`${action} queued...`);
    await loadRuntimeJobs();
    return await waitForRuntimeJobCompletion(jobId, successMessage);
  }

  async function cancelRuntimeJob(job: RuntimeJob) {
    const response = await fetch(`/api/tools/runtimes/jobs/${encodeURIComponent(job.id)}/cancel`, {
      method: "POST",
    });

    if (!response.ok) {
      const payload = (await response.json()) as { error?: string };
      setStatusMessage(payload.error ?? "Could not cancel runtime job.");
      return;
    }

    setStatusMessage(`Cancellation requested for ${job.action}.`);
    await loadRuntimeJobs();
  }

  async function retryRuntimeJob(job: RuntimeJob) {
    const response = await fetch(`/api/tools/runtimes/jobs/${encodeURIComponent(job.id)}/retry`, {
      method: "POST",
    });

    if (!response.ok) {
      const payload = (await response.json()) as { error?: string };
      setStatusMessage(payload.error ?? "Could not retry runtime job.");
      return;
    }

    setStatusMessage(`Retry queued for ${job.action}.`);
    await loadRuntimeJobs();
  }

  function toggleRuntimeJobExpanded(jobId: string) {
    setExpandedRuntimeJobIds((current) => ({ ...current, [jobId]: !current[jobId] }));
  }
  
  function stopVoicePlayback() {
    window.speechSynthesis.cancel();
    setVoicePlaying(false);
  }
  
  function playVoicePreview() {
    const text = voiceText.trim();
    if (!text) {
      return;
    }

    void (async () => {
      setVoicePlaying(true);
      const response = await fetch("/api/tools/voice/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voiceId: voicePreviewVoiceId || undefined }),
      });

      if (response.ok) {
        const payload = (await response.json()) as { audioBase64: string; mimeType: string };
        await playAudioPayload(payload);
        setVoicePlaying(false);
        return;
      }

      const payload = (await response.json()) as { error?: string };
      setStatusMessage(payload.error ?? "Voice playback failed.");
      stopVoicePlayback();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.onend = () => setVoicePlaying(false);
      utterance.onerror = () => setVoicePlaying(false);
      setVoicePlaying(true);
      window.speechSynthesis.speak(utterance);
    })();
  }

  async function saveVoiceGeneration() {
    const text = voiceText.trim();
    if (!text) {
      return;
    }

    setVoiceSaveBusy(true);
    const response = await fetch("/api/tools/voice/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voiceId: voicePreviewVoiceId || undefined, workspaceId: boot?.activeWorkspaceId }),
    });

    if (!response.ok) {
      const payload = (await response.json()) as { error?: string };
      setStatusMessage(payload.error ?? "Voice save failed.");
      setVoiceSaveBusy(false);
      return;
    }

    const payload = (await response.json()) as { relativePath: string };
    setStatusMessage(`Saved voice to ${payload.relativePath}`);
    setVoiceSaveBusy(false);
  }

  async function loadStableAudioStatus() {
    setStableAudioBusyAction("refresh");
    const response = await fetch("/api/tools/music/stable-audio/status");
    if (!response.ok) {
      const payload = (await response.json()) as { error?: string };
      setStatusMessage(payload.error ?? "Failed to load Stable Audio status.");
      pushToast(payload.error ?? "Failed to load Stable Audio status.", "err");
      setStableAudioBusyAction(null);
      return;
    }
    const payload = (await response.json()) as StableAudioStatus;
    setStableAudioStatus(payload);
    setStableAudioBusyAction(null);
  }

  async function generateStableAudio() {
    setStableAudioBusyAction("generate");
    const response = await fetch("/api/tools/music/stable-audio/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: stableAudioMode,
        prompt: stableAudioPrompt,
        duration: stableAudioDuration,
        workspaceId: boot?.activeWorkspaceId,
      }),
    });

    if (!response.ok) {
      const payload = (await response.json()) as { error?: string };
      const message = payload.error ?? "Stable Audio generation failed.";
      setStatusMessage(message);
      pushToast(message, "err");
      setStableAudioBusyAction(null);
      return;
    }

    const payload = (await response.json()) as { mode: "small-music" | "small-sfx" | "medium"; duration: number; prompt: string; relativePath: string; playbackUrl: string; workspaceId: string };
    setStableAudioGenerated((current) => [
      {
        mode: payload.mode,
        duration: payload.duration,
        prompt: payload.prompt,
        relativePath: payload.relativePath,
        playbackUrl: payload.playbackUrl,
      },
      ...current,
    ].slice(0, 8));
    setStatusMessage(`Saved generated audio to ${payload.relativePath}`);
    pushToast(`Generated ${payload.mode} clip saved to Assets.`, "ok");
    setStableAudioBusyAction(null);
    await refreshActiveWorkspaceTree(payload.workspaceId);
    await loadStableAudioStatus();
  }

  async function generateImage() {
    if (imageGenerationAbortRef.current) {
      imageGenerationAbortRef.current.abort();
    }
    const controller = new AbortController();
    imageGenerationAbortRef.current = controller;
    setImageBusyAction("generate");
    setImageStatusTrace("Starting Wan2GP image generation...\n");
    const ready = await ensureWan2GpReadyForGeneration();
    if (!ready) {
      setImageStatusTrace((current) => `${current}Wan2GP is still not ready after provisioning.\n`.slice(-12000));
      setStatusMessage("Wan2GP is still provisioning. Please retry in a moment.");
      setImageBusyAction(null);
      return;
    }
    const seedToUse = imageSeed < 0 ? Math.floor(Math.random() * 2147483647) : imageSeed;
    const params = new URLSearchParams({
      prompt: imagePrompt,
      model: imageModel,
      negativePrompt: imageNegativePrompt,
      width: String(imageWidth),
      height: String(imageHeight),
      steps: String(imageSteps),
      seed: String(seedToUse),
      profile: String(wanProfile),
      workspaceId: boot?.activeWorkspaceId ?? "default",
    });

    try {
      const response = await fetch(`/api/tools/wan2gp/image/stream?${params.toString()}`, {
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const payload = (await response.json()) as { error?: string };
        const message = payload.error ?? "Wan2GP image generation failed.";
        setStatusMessage(message);
        pushToast(message, "err");
        setImageBusyAction(null);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let completed = false;

      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });

        while (true) {
          const split = buffer.indexOf("\n\n");
          if (split === -1) {
            break;
          }
          const frame = buffer.slice(0, split);
          buffer = buffer.slice(split + 2);
          const dataLine = frame.split("\n").find((line) => line.startsWith("data:"));
          if (!dataLine) {
            continue;
          }
          const raw = dataLine.slice(5).trim();
          let envelope: LocalImageStreamEnvelope;
          try {
            envelope = JSON.parse(raw) as LocalImageStreamEnvelope;
          } catch {
            continue;
          }

          if (envelope.type === "status") {
            setImageStatusTrace((current) => `${current}${envelope.message}\n`.slice(-12000));
            continue;
          }

          if (envelope.type === "error") {
            setImageStatusTrace((current) => `${current}[error] ${envelope.message}\n`.slice(-12000));
            setStatusMessage(envelope.message);
            pushToast(envelope.message, "err");
            continue;
          }

          if (envelope.type === "done") {
            const generated: ImageGeneratedResult = {
              imageUrl: envelope.result.imageUrl,
              prompt: envelope.result.prompt,
              provider: envelope.result.provider,
              model: envelope.result.model,
              width: envelope.result.width,
              height: envelope.result.height,
              steps: envelope.result.steps,
              seed: envelope.result.seed,
              profile: envelope.result.profile,
              negativePrompt: envelope.result.negativePrompt,
              relativePath: envelope.result.relativePath,
              createdAt: new Date().toISOString(),
            };
            setImageResult(generated);
            setRecentImages((current) => [generated, ...current].slice(0, 10));
            setStatusMessage(`Wan2GP image generated (${envelope.result.model}).`);
            pushToast("Wan2GP image generated and saved.", "ok");
            completed = true;
            await refreshActiveWorkspaceTree(envelope.result.workspaceId);
            void loadWan2GpStatus();
          }
        }
      }

      if (!completed && !controller.signal.aborted) {
        setStatusMessage("Wan2GP image stream ended before completion.");
      }
    } catch (error) {
      if (controller.signal.aborted) {
        setImageStatusTrace((current) => `${current}Generation canceled by user.\n`.slice(-12000));
        setStatusMessage("Wan2GP image generation stopped.");
        pushToast("Image generation canceled.", "warn");
      } else {
        const message = String(error);
        setImageStatusTrace((current) => `${current}[error] ${message}\n`.slice(-12000));
        setStatusMessage(message);
        pushToast(message, "err");
      }
    } finally {
      if (imageGenerationAbortRef.current === controller) {
        imageGenerationAbortRef.current = null;
      }
      setImageBusyAction(null);
    }
  }

  function stopImageGeneration() {
    imageGenerationAbortRef.current?.abort();
  }

  async function saveGeneratedImage(target?: ImageGeneratedResult) {
    const imageToSave = target ?? imageResult;
    if (!imageToSave?.imageUrl) {
      return;
    }
    setImageBusyAction("save");
    const response = await fetch("/api/tools/image/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        imageUrl: imageToSave.imageUrl,
        prompt: imageToSave.prompt,
        workspaceId: boot?.activeWorkspaceId,
      }),
    });

    if (!response.ok) {
      const payload = (await response.json()) as { error?: string };
      const message = payload.error ?? "Image save failed.";
      setStatusMessage(message);
      pushToast(message, "err");
      setImageBusyAction(null);
      return;
    }

    const payload = (await response.json()) as { relativePath: string; workspaceId: string };
    setImageResult((current) => {
      if (!current || current.imageUrl !== imageToSave.imageUrl) {
        return current;
      }
      return { ...current, relativePath: payload.relativePath };
    });
    setRecentImages((current) => current.map((item) => (
      item.imageUrl === imageToSave.imageUrl
        ? { ...item, relativePath: payload.relativePath }
        : item
    )));
    setStatusMessage(`Saved generated image to ${payload.relativePath}`);
    pushToast("Image saved to Assets/images.", "ok");
    await refreshActiveWorkspaceTree(payload.workspaceId);
    setImageBusyAction(null);
  }

  function applyImageSizePreset(preset: ImageSizePreset) {
    setImageWidth(preset.width);
    setImageHeight(preset.height);
    setStatusMessage(`Applied ${preset.label} preset.`);
  }

  function openRecentImage(image: ImageGeneratedResult) {
    setImagePrompt(image.prompt);
    setImageNegativePrompt(image.negativePrompt ?? "");
    setImageModel(image.model || "auto");
    setImageWidth(image.width);
    setImageHeight(image.height);
    setImageSteps(image.steps ?? 6);
    setWanProfile(image.profile ?? wan2GpStatus?.recommended.profile ?? 4);
    setImageSeed(image.seed ?? -1);
    setImageResult(image);
    setStatusMessage("Loaded recent image into preview.");
  }

  async function loadWan2GpStatus() {
    const response = await fetch("/api/tools/wan2gp/status");
    if (!response.ok) {
      return;
    }
    const payload = (await response.json()) as Wan2GpStatus;
    setWan2GpStatus(payload);
    setWanProfile((current) => current > 0 ? current : payload.recommended.profile);
  }

  async function ensureWan2GpReadyForGeneration(): Promise<boolean> {
    let current = wan2GpStatus;
    const fresh = await fetch("/api/tools/wan2gp/status").catch(() => null);
    if (fresh?.ok) {
      current = await fresh.json() as Wan2GpStatus;
      setWan2GpStatus(current);
    }

    if (current?.apiReady) {
      return true;
    }

    setStatusMessage("Wan2GP is not ready yet. Starting automatic runtime provisioning...");
    pushToast("Provisioning Wan2GP runtime now.", "warn");

    const needsInstall = !current?.installed || !current?.envReady;
    if (needsInstall) {
      const installResult = await runRuntimeJob("wan2gp-install", "install-wan2gp", "Wan2GP installed.");
      if (!installResult.ok) {
        setStatusMessage(installResult.error ?? "Wan2GP install failed.");
        return false;
      }
    }

    const startResult = await runRuntimeJob("wan2gp-start", "start-wan2gp", "Wan2GP ready.");
    if (!startResult.ok) {
      setStatusMessage(startResult.error ?? "Wan2GP start/check failed.");
      return false;
    }

    const refreshed = await fetch("/api/tools/wan2gp/status");
    if (!refreshed.ok) {
      return false;
    }
    const payload = (await refreshed.json()) as Wan2GpStatus;
    setWan2GpStatus(payload);
    if (!payload.apiReady) {
      const detail = payload.notes?.[payload.notes.length - 1] ?? "Wan2GP readiness check failed.";
      setStatusMessage(detail);
    }
    return payload.apiReady;
  }

  async function generateVideo() {
    if (videoGenerationAbortRef.current) {
      videoGenerationAbortRef.current.abort();
    }
    const controller = new AbortController();
    videoGenerationAbortRef.current = controller;
    setVideoBusyAction("generate");
    setVideoStatusTrace("Starting Wan2GP video generation...\n");
    const ready = await ensureWan2GpReadyForGeneration();
    if (!ready) {
      setVideoStatusTrace((current) => `${current}Wan2GP is still not ready after provisioning.\n`.slice(-12000));
      setStatusMessage("Wan2GP is still provisioning. Please retry in a moment.");
      setVideoBusyAction(null);
      return;
    }
    const seedToUse = videoSeed < 0 ? Math.floor(Math.random() * 2147483647) : videoSeed;
    const params = new URLSearchParams({
      prompt: videoPrompt,
      model: videoModel,
      negativePrompt: videoNegativePrompt,
      width: String(videoWidth),
      height: String(videoHeight),
      steps: String(videoSteps),
      seed: String(seedToUse),
      profile: String(wanProfile),
      durationSeconds: String(videoDurationSeconds),
      fps: String(videoFps),
      frameCount: String(videoFrameCount),
      workspaceId: boot?.activeWorkspaceId ?? "default",
    });

    try {
      const response = await fetch(`/api/tools/wan2gp/video/stream?${params.toString()}`, {
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const payload = (await response.json()) as { error?: string };
        const message = payload.error ?? "Wan2GP video generation failed.";
        setStatusMessage(message);
        pushToast(message, "err");
        setVideoBusyAction(null);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let completed = false;

      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });

        while (true) {
          const split = buffer.indexOf("\n\n");
          if (split === -1) {
            break;
          }
          const frame = buffer.slice(0, split);
          buffer = buffer.slice(split + 2);
          const dataLine = frame.split("\n").find((line) => line.startsWith("data:"));
          if (!dataLine) {
            continue;
          }
          const raw = dataLine.slice(5).trim();
          let envelope: Wan2GpVideoStreamEnvelope;
          try {
            envelope = JSON.parse(raw) as Wan2GpVideoStreamEnvelope;
          } catch {
            continue;
          }

          if (envelope.type === "status") {
            setVideoStatusTrace((current) => `${current}${envelope.message}\n`.slice(-12000));
            continue;
          }

          if (envelope.type === "error") {
            setVideoStatusTrace((current) => `${current}[error] ${envelope.message}\n`.slice(-12000));
            setStatusMessage(envelope.message);
            pushToast(envelope.message, "err");
            continue;
          }

          if (envelope.type === "done") {
            const generated: VideoGeneratedResult = {
              videoUrl: envelope.result.videoUrl,
              prompt: envelope.result.prompt,
              provider: envelope.result.provider,
              model: envelope.result.model,
              width: envelope.result.width,
              height: envelope.result.height,
              steps: envelope.result.steps,
              seed: envelope.result.seed,
              profile: envelope.result.profile,
              durationSeconds: envelope.result.durationSeconds,
              fps: envelope.result.fps,
              frameCount: envelope.result.frameCount,
              negativePrompt: envelope.result.negativePrompt,
              relativePath: envelope.result.relativePath,
              createdAt: new Date().toISOString(),
            };
            setVideoResult(generated);
            setRecentVideos((current) => [generated, ...current].slice(0, 10));
            setStatusMessage(`Wan2GP video generated (${envelope.result.model}).`);
            pushToast("Wan2GP video generated and saved.", "ok");
            completed = true;
            await refreshActiveWorkspaceTree(envelope.result.workspaceId);
            void loadWan2GpStatus();
          }
        }
      }

      if (!completed && !controller.signal.aborted) {
        setStatusMessage("Wan2GP video stream ended before completion.");
      }
    } catch (error) {
      if (controller.signal.aborted) {
        setVideoStatusTrace((current) => `${current}Generation canceled by user.\n`.slice(-12000));
        setStatusMessage("Wan2GP video generation stopped.");
        pushToast("Video generation canceled.", "warn");
      } else {
        const message = String(error);
        setVideoStatusTrace((current) => `${current}[error] ${message}\n`.slice(-12000));
        setStatusMessage(message);
        pushToast(message, "err");
      }
    } finally {
      if (videoGenerationAbortRef.current === controller) {
        videoGenerationAbortRef.current = null;
      }
      setVideoBusyAction(null);
    }
  }

  function stopVideoGeneration() {
    videoGenerationAbortRef.current?.abort();
  }

  function openRecentVideo(video: VideoGeneratedResult) {
    setVideoPrompt(video.prompt);
    setVideoNegativePrompt(video.negativePrompt ?? "");
    setVideoModel(video.model || "auto");
    setVideoWidth(video.width);
    setVideoHeight(video.height);
    setVideoSteps(video.steps ?? 6);
    setVideoSeed(video.seed ?? -1);
    setVideoDurationSeconds(video.durationSeconds ?? 3);
    setVideoFps(video.fps ?? 16);
    setVideoFrameCount(video.frameCount ?? 49);
    setWanProfile(video.profile ?? wan2GpStatus?.recommended.profile ?? 4);
    setVideoResult(video);
    setStatusMessage("Loaded recent video into preview.");
  }

  async function loadHunyuan3dStatus() {
    const response = await fetch("/api/tools/hunyuan3d/status");
    if (!response.ok) {
      return;
    }
    const payload = (await response.json()) as Hunyuan3dStatus;
    setHunyuan3dStatus(payload);
    setModel3dModelPath((current) => current.trim() ? current : payload.recommended.modelPath);
    setModel3dSubfolder((current) => current.trim() ? current : payload.recommended.subfolder);
  }

  async function ensureHunyuan3dReadyForGeneration(): Promise<boolean> {
    let current = hunyuan3dStatus;
    const fresh = await fetch("/api/tools/hunyuan3d/status").catch(() => null);
    if (fresh?.ok) {
      current = await fresh.json() as Hunyuan3dStatus;
      setHunyuan3dStatus(current);
    }

    if (current?.apiReady) {
      return true;
    }

    setStatusMessage("Hunyuan3D-2GP is not ready yet. Starting automatic runtime provisioning...");
    pushToast("Provisioning Hunyuan3D-2GP runtime now.", "warn");

    const needsInstall = !current?.installed || !current?.envReady;
    if (needsInstall) {
      const installResult = await runRuntimeJob("hunyuan3d-install", "install-hunyuan3d", "Hunyuan3D-2GP installed.");
      if (!installResult.ok) {
        setStatusMessage(installResult.error ?? "Hunyuan3D-2GP install failed.");
        return false;
      }
    }

    const startResult = await runRuntimeJob("hunyuan3d-start", "start-hunyuan3d", "Hunyuan3D-2GP ready.");
    if (!startResult.ok) {
      setStatusMessage(startResult.error ?? "Hunyuan3D-2GP readiness check failed.");
      return false;
    }

    const refreshed = await fetch("/api/tools/hunyuan3d/status");
    if (!refreshed.ok) {
      return false;
    }
    const payload = (await refreshed.json()) as Hunyuan3dStatus;
    setHunyuan3dStatus(payload);
    if (!payload.apiReady) {
      const detail = payload.notes?.[payload.notes.length - 1] ?? "Hunyuan3D-2GP readiness check failed.";
      setStatusMessage(detail);
    }
    return payload.apiReady;
  }

  async function generateModel3d() {
    if (model3dGenerationAbortRef.current) {
      model3dGenerationAbortRef.current.abort();
    }
    const controller = new AbortController();
    model3dGenerationAbortRef.current = controller;
    setModel3dBusyAction("generate");
    setModel3dStatusTrace("Starting Hunyuan3D-2GP generation...\n");

    const sourceImageUrl = model3dSourceImageUrl.trim();
    const sourceImageBase64 = model3dSourceImageBase64.trim();
    const useTextMode = model3dInputMode === "text";
    const textPrompt = model3dTextPrompt.trim();
    if (!useTextMode && !sourceImageUrl && !sourceImageBase64) {
      setStatusMessage("Provide a source image URL or upload an image for 3D generation.");
      pushToast("Provide or upload a source image first.", "warn");
      setModel3dBusyAction(null);
      return;
    }

    if (useTextMode && !textPrompt) {
      setStatusMessage("Enter a text prompt for text-to-3D generation.");
      pushToast("Text prompt is required for text-to-3D.", "warn");
      setModel3dBusyAction(null);
      return;
    }

    const ready = await ensureHunyuan3dReadyForGeneration();
    if (!ready) {
      setModel3dStatusTrace((current) => `${current}Hunyuan3D-2GP is still not ready after provisioning.\n`.slice(-16000));
      setStatusMessage("Hunyuan3D-2GP is still provisioning. Please retry in a moment.");
      setModel3dBusyAction(null);
      return;
    }

    const seedToUse = model3dSeed < 0 ? Math.floor(Math.random() * 2147483647) : model3dSeed;
    const textImageSeedToUse = model3dTextImageSeed < 0 ? Math.floor(Math.random() * 2147483647) : model3dTextImageSeed;
    const requestBody = {
      imageUrl: useTextMode ? undefined : (sourceImageUrl || undefined),
      imageBase64: useTextMode ? undefined : (sourceImageBase64 || undefined),
      textPrompt: useTextMode ? textPrompt : undefined,
      textNegativePrompt: useTextMode ? model3dTextNegativePrompt : undefined,
      textImageModel: useTextMode ? model3dTextImageModel : undefined,
      textImageWidth: useTextMode ? model3dTextImageWidth : undefined,
      textImageHeight: useTextMode ? model3dTextImageHeight : undefined,
      textImageSteps: useTextMode ? model3dTextImageSteps : undefined,
      textImageProfile: useTextMode ? model3dTextImageProfile : undefined,
      textImageSeed: useTextMode ? textImageSeedToUse : undefined,
      modelPath: model3dModelPath,
      subfolder: model3dSubfolder,
      numInferenceSteps: model3dNumInferenceSteps,
      octreeResolution: model3dOctreeResolution,
      guidanceScale: model3dGuidanceScale,
      seed: seedToUse,
      format: model3dFormat,
      workspaceId: boot?.activeWorkspaceId ?? "default",
    };

    try {
      const response = await fetch("/api/tools/hunyuan3d/generate/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const payload = (await response.json()) as { error?: string };
        const message = payload.error ?? "Hunyuan3D generation failed.";
        setStatusMessage(message);
        pushToast(message, "err");
        setModel3dBusyAction(null);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let completed = false;

      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });

        while (true) {
          const split = buffer.indexOf("\n\n");
          if (split === -1) {
            break;
          }
          const frame = buffer.slice(0, split);
          buffer = buffer.slice(split + 2);
          const dataLine = frame.split("\n").find((line) => line.startsWith("data:"));
          if (!dataLine) {
            continue;
          }
          const raw = dataLine.slice(5).trim();
          let envelope: Hunyuan3dStreamEnvelope;
          try {
            envelope = JSON.parse(raw) as Hunyuan3dStreamEnvelope;
          } catch {
            continue;
          }

          if (envelope.type === "status") {
            setModel3dStatusTrace((current) => `${current}${envelope.message}\n`.slice(-16000));
            continue;
          }

          if (envelope.type === "error") {
            setModel3dStatusTrace((current) => `${current}[error] ${envelope.message}\n`.slice(-16000));
            setStatusMessage(envelope.message);
            pushToast(envelope.message, "err");
            continue;
          }

          if (envelope.type === "done") {
            const generated: Model3dGeneratedResult = {
              modelUrl: envelope.result.modelUrl,
              provider: envelope.result.provider,
              modelPath: envelope.result.modelPath,
              subfolder: envelope.result.subfolder,
              numInferenceSteps: envelope.result.numInferenceSteps,
              octreeResolution: envelope.result.octreeResolution,
              guidanceScale: envelope.result.guidanceScale,
              seed: envelope.result.seed,
              format: envelope.result.format,
              device: envelope.result.device,
              sourceKind: envelope.result.sourceKind,
              sourceImageUrl: envelope.result.sourceImageUrl,
              relativePath: envelope.result.relativePath,
              createdAt: new Date().toISOString(),
            };
            setModel3dSourceImageUrl(envelope.result.sourceImageUrl);
            setModel3dSourceImageBase64("");
            setModel3dSourceImageFileName("");
            setModel3dResult(generated);
            setRecentModels3d((current) => [generated, ...current].slice(0, 10));
            setStatusMessage("Hunyuan3D mesh generated and saved.");
            pushToast("Hunyuan3D mesh generated and saved.", "ok");
            completed = true;
            await refreshActiveWorkspaceTree(envelope.result.workspaceId);
            void loadHunyuan3dStatus();
          }
        }
      }

      if (!completed && !controller.signal.aborted) {
        setStatusMessage("Hunyuan3D stream ended before completion.");
      }
    } catch (error) {
      if (controller.signal.aborted) {
        setModel3dStatusTrace((current) => `${current}Generation canceled by user.\n`.slice(-16000));
        setStatusMessage("Hunyuan3D generation stopped.");
        pushToast("3D generation canceled.", "warn");
      } else {
        const message = String(error);
        setModel3dStatusTrace((current) => `${current}[error] ${message}\n`.slice(-16000));
        setStatusMessage(message);
        pushToast(message, "err");
      }
    } finally {
      if (model3dGenerationAbortRef.current === controller) {
        model3dGenerationAbortRef.current = null;
      }
      setModel3dBusyAction(null);
    }
  }

  function stopModel3dGeneration() {
    model3dGenerationAbortRef.current?.abort();
  }

  function onModel3dSourceFileSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    if (!file) {
      setModel3dSourceImageBase64("");
      setModel3dSourceImageFileName("");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const loaded = String(reader.result ?? "");
      const split = loaded.indexOf(",");
      const base64 = split >= 0 ? loaded.slice(split + 1).trim() : "";
      if (!base64) {
        setStatusMessage("Could not read selected image file.");
        pushToast("Image upload read failed.", "err");
        return;
      }
      setModel3dSourceImageBase64(base64);
      setModel3dSourceImageFileName(file.name);
      setModel3dSourceImageMime(file.type || "image/png");
      setModel3dSourceImageUrl("");
      setModel3dInputMode("image");
      setStatusMessage(`Loaded uploaded image: ${file.name}`);
      pushToast("Uploaded image ready for 3D generation.", "ok");
    };
    reader.onerror = () => {
      setStatusMessage("Could not read selected image file.");
      pushToast("Image upload read failed.", "err");
    };
    reader.readAsDataURL(file);
  }

  function useLatestGeneratedImageFor3d() {
    const candidate = imageResult?.imageUrl ?? recentImages[0]?.imageUrl ?? "";
    if (!candidate) {
      setStatusMessage("Generate an image first, then use it as 3D source.");
      return;
    }
    setModel3dSourceImageUrl(candidate);
    setModel3dSourceImageBase64("");
    setModel3dSourceImageFileName("");
    setModel3dSourceImageMime("image/png");
    setModel3dInputMode("image");
    setStatusMessage("Loaded latest generated image as 3D source.");
  }

  function openRecentModel3d(model: Model3dGeneratedResult) {
    const sourceLooksLikeUrl = /^https?:\/\//i.test(model.sourceImageUrl) || model.sourceImageUrl.startsWith("/api/") || model.sourceImageUrl.startsWith("data:image/");
    setModel3dSourceImageUrl(sourceLooksLikeUrl ? model.sourceImageUrl : "");
    setModel3dSourceImageBase64("");
    setModel3dSourceImageFileName("");
    setModel3dSourceImageMime("image/png");
    setModel3dInputMode(model.sourceKind === "text" ? "text" : "image");
    setModel3dModelPath(model.modelPath);
    setModel3dSubfolder(model.subfolder);
    setModel3dNumInferenceSteps(model.numInferenceSteps);
    setModel3dOctreeResolution(model.octreeResolution);
    setModel3dGuidanceScale(model.guidanceScale);
    setModel3dSeed(model.seed);
    setModel3dFormat(model.format);
    setModel3dResult(model);
    setStatusMessage("Loaded recent 3D generation into preview.");
  }

  async function openActiveWorkspaceFolder() {
    const workspaceId = boot?.activeWorkspaceId ?? "default";
    const response = await fetch("/api/workspaces/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId }),
    });

    if (!response.ok) {
      const payload = (await response.json()) as { error?: string };
      const message = payload.error ?? "Failed to open workspace folder.";
      setStatusMessage(message);
      pushToast(message, "err");
      return;
    }

    setStatusMessage("Opened workspace folder in file explorer.");
  }

  // Nexus Router state
  const [nxProviders, setNxProviders] = useState<NxProvider[]>([]);
  const [nxProviderForm, setNxProviderForm] = useState({ preset: "openrouter", id: "openrouter", name: "OpenRouter", type: "openrouter" as NxProvider["type"], baseUrl: "https://openrouter.ai/api/v1", apiKey: "", defaultModel: "openai/gpt-4.1-mini", enabled: true });
  const [nxSaving, setNxSaving] = useState(false);
  const [nxSyncingId, setNxSyncingId] = useState<string | null>(null);
  const [nxFallbackRows, setNxFallbackRows] = useState<NxFallbackRow[]>([]);
  const [nxModelOptionsByProvider, setNxModelOptionsByProvider] = useState<Record<string, string[]>>({});
  const [nxHarnessAssignments, setNxHarnessAssignments] = useState<Record<string, string[]>>({});
  const [nxRetryEditor, setNxRetryEditor] = useState<NxRetryPolicy>({ maxAttempts: 3, backoffMs: 400, retryOnStatus: [429, 500, 502, 503, 504] });
  const [nxTestPrompt, setNxTestPrompt] = useState("Say hello briefly.");
  const [nxTestResult, setNxTestResult] = useState<{ content: string; model: string; providerId: string; elapsedMs: number; attempts: Array<{ providerId: string; model: string; status: string; details: string }> } | null>(null);
  const [nxTestBusy, setNxTestBusy] = useState(false);
  const [nxConsoleLogs, setNxConsoleLogs] = useState<Array<{ timestamp: string; level: string; message: string }>>([]);
  const [harnessCapabilitiesByHarness, setHarnessCapabilitiesByHarness] = useState<Record<string, HarnessCapabilitySettings>>({});
  const [harnessExtrasOpenByHarness, setHarnessExtrasOpenByHarness] = useState<Record<string, boolean>>({});
  const [harnessCapabilitySavingId, setHarnessCapabilitySavingId] = useState<string | null>(null);
  const nxAutoSyncStarted = useRef(false);

  const activeHarness = useMemo(
    () => boot?.harnesses.find((harness) => harness.id === selectedPane.id) ?? null,
    [boot, selectedPane.id],
  );

  function createThread(title = "New chat"): HarnessChatThread {
    const nowIso = new Date().toISOString();
    return {
      id: crypto.randomUUID(),
      title,
      messages: [],
      meta: null,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
  }

  function upsertThread(
    harnessId: string,
    threadId: string,
    updater: (thread: HarnessChatThread) => HarnessChatThread,
  ) {
    setChatThreadsByHarness((current) => {
      const threads = current[harnessId] ?? [];
      return {
        ...current,
        [harnessId]: threads.map((thread) => (thread.id === threadId ? updater(thread) : thread)),
      };
    });
  }

  function ensureHarnessThread(harnessId: string): string {
    const existing = chatThreadsByHarness[harnessId] ?? [];
    const activeId = activeThreadByHarness[harnessId];
    if (existing.length > 0) {
      const resolved = activeId && existing.some((thread) => thread.id === activeId) ? activeId : existing[0].id;
      if (!activeId || activeId !== resolved) {
        setActiveThreadByHarness((current) => ({ ...current, [harnessId]: resolved }));
      }
      return resolved;
    }

    const thread = createThread();
    setChatThreadsByHarness((current) => ({ ...current, [harnessId]: [thread] }));
    setActiveThreadByHarness((current) => ({ ...current, [harnessId]: thread.id }));
    void saveHarnessThread(harnessId, thread);
    return thread.id;
  }

  const activeThread = useMemo(() => {
    if (selectedPane.type !== "agent") {
      return null;
    }
    const harnessId = selectedPane.id;
    const threads = chatThreadsByHarness[harnessId] ?? [];
    if (threads.length === 0) {
      return null;
    }
    const activeId = activeThreadByHarness[harnessId] ?? threads[0].id;
    return threads.find((thread) => thread.id === activeId) ?? threads[0];
  }, [selectedPane, chatThreadsByHarness, activeThreadByHarness]);

  const messages = activeThread?.messages ?? [];
  const chatMeta = activeThread?.meta ?? null;
  const lastAssistantMessageId = useMemo(
    () => [...messages].reverse().find((message) => message.role === "assistant")?.id,
    [messages],
  );

  const harnessDisplayModel = useMemo(() => {
    const modelByHarness: Record<string, string> = {};
    for (const [harnessId, threads] of Object.entries(chatThreadsByHarness)) {
      const newest = [...threads]
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
        .find((thread) => Boolean(thread.meta?.model));
      if (newest?.meta?.model) {
        modelByHarness[harnessId] = newest.meta.model;
      }
    }
    return modelByHarness;
  }, [chatThreadsByHarness]);

  async function loadHarnessThreads(harnessId: string, workspaceId?: string) {
    const activeWorkspaceId = workspaceId ?? boot?.activeWorkspaceId ?? "default";
    const response = await fetch(`/api/harnesses/${encodeURIComponent(harnessId)}/chats?workspaceId=${encodeURIComponent(activeWorkspaceId)}`);
    if (!response.ok) {
      return;
    }
    const payload = (await response.json()) as { threads: HarnessChatThread[] };
    const threads = (payload.threads ?? []).map((thread) => ({
      ...thread,
      createdAt: thread.createdAt ?? thread.updatedAt ?? new Date().toISOString(),
    }));
    setChatThreadsByHarness((current) => ({ ...current, [harnessId]: threads }));
    if (threads.length > 0) {
      setActiveThreadByHarness((current) => ({
        ...current,
        [harnessId]: current[harnessId] && threads.some((thread) => thread.id === current[harnessId])
          ? current[harnessId]
          : threads[0].id,
      }));
      return;
    }

    const thread = createThread();
    await saveHarnessThread(harnessId, thread, activeWorkspaceId);
    setChatThreadsByHarness((current) => ({ ...current, [harnessId]: [thread] }));
    setActiveThreadByHarness((current) => ({ ...current, [harnessId]: thread.id }));
  }

  async function saveHarnessThread(harnessId: string, thread: HarnessChatThread, workspaceId?: string): Promise<void> {
    const activeWorkspaceId = workspaceId ?? boot?.activeWorkspaceId ?? "default";
    await fetch(`/api/harnesses/${encodeURIComponent(harnessId)}/chats/${encodeURIComponent(thread.id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceId: activeWorkspaceId,
        title: thread.title,
        messages: thread.messages,
        meta: thread.meta,
        createdAt: thread.createdAt,
        updatedAt: thread.updatedAt,
      }),
    });
  }

  const fallbackChoiceOptions = useMemo(
    () => nxFallbackRows
      .filter((row) => row.providerId && row.model)
      .map((row) => `${row.providerId}::${row.model}`),
    [nxFallbackRows],
  );

  const fallbackChoiceSet = useMemo(() => new Set(fallbackChoiceOptions), [fallbackChoiceOptions]);

  const cookbookModelOptions = useMemo(() => cookbookSnapshot?.installedModels ?? [], [cookbookSnapshot]);

  const cookbookProviderView = useMemo<NxProviderView | null>(() => {
    if (!cookbookSnapshot && !runtimeStatus) {
      return null;
    }

    return {
      id: "cookbook",
      name: "Cookbook",
      enabled: cookbookModelOptions.length > 0,
      models: cookbookModelOptions,
      lastSyncedAt: cookbookSnapshot?.scannedAt,
      maskedApiKey: "",
      isLocal: true,
    };
  }, [cookbookSnapshot, runtimeStatus, cookbookModelOptions]);

  const nxProviderViews = useMemo<NxProviderView[]>(() => {
    const remoteProviders = nxProviders.map((provider) => ({
      id: provider.id,
      name: provider.name,
      enabled: provider.enabled,
      models: nxModelOptionsByProvider[provider.id] ?? provider.models ?? [],
      baseUrl: provider.baseUrl,
      lastSyncedAt: provider.lastSyncedAt,
      maskedApiKey: provider.maskedApiKey,
    }));

    return cookbookProviderView ? [cookbookProviderView, ...remoteProviders] : remoteProviders;
  }, [cookbookProviderView, nxProviders, nxModelOptionsByProvider]);

  function createFallbackRow(target?: NxFallbackTarget): NxFallbackRow {
    return {
      id: crypto.randomUUID(),
      providerId: target?.providerId ?? "",
      model: target?.model ?? "",
    };
  }

  function fallbackKey(target: NxFallbackTarget): string {
    return `${target.providerId}::${target.model}`;
  }

  function moveFallbackRow(rowId: string, direction: -1 | 1) {
    setNxFallbackRows((rows) => {
      const index = rows.findIndex((entry) => entry.id === rowId);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= rows.length) {
        return rows;
      }

      const next = [...rows];
      const [moved] = next.splice(index, 1);
      next.splice(nextIndex, 0, moved);
      return next;
    });
  }

  function getProviderApiKeyUrl(provider: { id: string; name: string; baseUrl?: string }): string | null {
    const id = provider.id.toLowerCase();
    if (PROVIDER_API_KEY_LINKS[id]) {
      return PROVIDER_API_KEY_LINKS[id];
    }

    const providerName = provider.name.toLowerCase();
    if (providerName.includes("deepseek")) {
      return PROVIDER_API_KEY_LINKS.deepseek;
    }
    if (providerName.includes("anthropic") || providerName.includes("claude")) {
      return PROVIDER_API_KEY_LINKS.anthropic;
    }

    if (!provider.baseUrl) {
      return null;
    }

    try {
      const host = new URL(provider.baseUrl).hostname.toLowerCase();
      if (host.includes("openrouter.ai")) return PROVIDER_API_KEY_LINKS.openrouter;
      if (host.includes("openai.com")) return PROVIDER_API_KEY_LINKS.openai;
      if (host.includes("anthropic.com")) return PROVIDER_API_KEY_LINKS.anthropic;
      if (host.includes("deepseek.com")) return PROVIDER_API_KEY_LINKS.deepseek;
      if (host.includes("together.xyz")) return PROVIDER_API_KEY_LINKS.together;
      if (host.includes("groq.com")) return PROVIDER_API_KEY_LINKS.groq;
      if (host.includes("mistral.ai")) return PROVIDER_API_KEY_LINKS.mistral;
      if (host.includes("x.ai")) return PROVIDER_API_KEY_LINKS.xai;
      if (host.includes("fireworks.ai")) return PROVIDER_API_KEY_LINKS.fireworks;
      if (host.includes("googleapis.com") || host.includes("generativelanguage.googleapis.com")) return PROVIDER_API_KEY_LINKS.google;
    } catch {
      return null;
    }

    return null;
  }

  function parseFallbackKey(value: string): NxFallbackTarget | null {
    const [providerId, ...rest] = value.split("::");
    const model = rest.join("::").trim();
    const trimmedProvider = providerId.trim();
    if (!trimmedProvider || !model) {
      return null;
    }
    return { providerId: trimmedProvider, model };
  }

  function defaultHarnessCapabilities(): HarnessCapabilitySettings {
    const codingHarness = selectedPane.type === "agent" && ["free-claude-code", "free-code", "opencode"].includes(selectedPane.id);
    return {
      fableMode: {
        enabled: codingHarness,
        profile: codingHarness ? "balanced" : "off",
      },
      openDesign: {
        enabled: false,
      },
      crawl4ai: {
        enabled: false,
        allowedDomains: [],
        allowExternalDomains: false,
        obeyRobotsTxt: true,
        maxPages: 8,
        timeoutMs: 45000,
      },
      officeCli: {
        enabled: false,
        allowedExtensions: [".docx", ".xlsx", ".pptx", ".txt", ".md", ".csv", ".json"],
        maxFileSizeMb: 32,
      },
    };
  }

  function parseCommaList(value: string): string[] {
    return value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  function recommendationSymbol(recommendation: CookbookRecommendation): string {
    if (recommendation.category === "coding") return "</>";
    if (recommendation.category === "chat") return "[]";
    if (recommendation.category === "image") return "IMG";
    if (recommendation.category === "video") return "VID";
    return "()";
  }

  function recommendationModelName(recommendation: CookbookRecommendation): string | null {
    return RECOMMENDED_OLLAMA_MODELS[recommendation.id] ?? null;
  }

  function findActiveModelPullJob(model: string): RuntimeJob | null {
    return runtimeJobs.find((job) =>
      job.action === "pull-ollama-model"
      && job.model === model
      && (job.status === "queued" || job.status === "running" || job.status === "canceling")
    ) ?? null;
  }

  async function runRecommendationAction(recommendation: CookbookRecommendation) {
    if (recommendation.runtime !== "ollama") {
      setStatusMessage("This recommendation is provisioned by core runtime setup.");
      return;
    }

    const model = recommendationModelName(recommendation);
    if (!model) {
      setStatusMessage("No install target mapped for this recommendation yet.");
      return;
    }

    const activePull = findActiveModelPullJob(model);
    if (activePull) {
      await cancelRuntimeJob(activePull);
      return;
    }

    if (runtimeStatus?.ollamaModels.includes(model)) {
      setStatusMessage(`${model} is already installed.`);
      return;
    }

    await runRuntimeJob(
      `pull-${model}`,
      "pull-ollama-model",
      `${recommendation.name} installed into Ollama.`,
      model,
    );
  }

  async function handoffCookbookModelsToRouter() {
    const cookbookTargets = Array.from(new Set(cookbookModelOptions))
      .slice(0, 4)
      .map((model) => ({ providerId: "cookbook", model }));

    if (cookbookTargets.length === 0) {
      setStatusMessage("No Cookbook-installed local models found yet.");
      return;
    }

    setCookbookRouterHandoffBusy(true);
    try {
      const cfgRes = await fetch("/api/router/config");
      if (!cfgRes.ok) {
        const err = (await cfgRes.json()) as { error?: string };
        setStatusMessage(err.error ?? "Failed to load router config.");
        return;
      }

      const current = (await cfgRes.json()) as NxRouterConfig;
      const existingNonCookbook = (current.fallbackChain ?? []).filter((target) => target.providerId !== "cookbook");
      const nextFallback = [...cookbookTargets, ...existingNonCookbook].slice(0, 8);

      const saveRes = await fetch("/api/router/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fallbackChain: nextFallback,
          harnessAssignments: current.harnessAssignments ?? {},
          retryPolicy: current.retryPolicy ?? nxRetryEditor,
        }),
      });

      if (!saveRes.ok) {
        const err = (await saveRes.json()) as { error?: string };
        setStatusMessage(err.error ?? "Failed to sync Cookbook models into Router fallback.");
        return;
      }

      await loadNxRouter();
      setSelectedPane({ type: "tool", id: "nexus-router" });
      setStatusMessage("Cookbook models imported into Router fallback chain.");
    } finally {
      setCookbookRouterHandoffBusy(false);
    }
  }

  function getFallbackRowHealth(row: NxFallbackRow): { label: string; tone: "ok" | "warn" | "bad" | "idle" } {
    if (!row.providerId) {
      return { label: "select provider", tone: "idle" };
    }

    const provider = nxProviderViews.find((entry) => entry.id === row.providerId);
    if (!provider || !provider.enabled) {
      return { label: "provider offline", tone: "bad" };
    }

    if (!row.model) {
      return { label: "select model", tone: "idle" };
    }

    const providerModels = nxModelOptionsByProvider[row.providerId] ?? provider.models ?? [];
    if (providerModels.length === 0) {
      return { label: provider.lastSyncedAt ? "no synced models" : "syncing models", tone: "warn" };
    }

    if (!providerModels.includes(row.model)) {
      return { label: "model unavailable", tone: "bad" };
    }

    return { label: "healthy", tone: "ok" };
  }

  const loadBootstrap = useCallback(async () => {
    const response = await fetch("/api/bootstrap");
    const payload = (await response.json()) as BootstrapPayload;
    setBoot(payload);
    setStartupStrictMode(Boolean(payload.startupStrictMode));

    const payloadPane = payload.selectedPane;
    if (payloadPane.type === "tool") {
      if (payloadPane.id === "voice-studio") {
        setMediaCenterTab("voice");
      } else if (payloadPane.id === "music-generator") {
        setMediaCenterTab("music");
      } else if (payloadPane.id === "image-generator") {
        setMediaCenterTab("image");
      } else if (payloadPane.id === "video-generator") {
        setMediaCenterTab("video");
      } else if (payloadPane.id === "models-generator") {
        setMediaCenterTab("models");
      }
    }

    const normalizedSelectedPane: PaneSelection = payloadPane.type === "tool"
      && (payloadPane.id === "voice-studio"
        || payloadPane.id === "music-generator"
        || payloadPane.id === "image-generator"
        || payloadPane.id === "video-generator"
        || payloadPane.id === "models-generator")
      ? { type: "tool", id: "media-center" }
      : payloadPane;

    const preferredPane: PaneSelection = payload.onboardingRequired
      ? { type: "tool", id: "nexus-router" }
      : normalizedSelectedPane;
    setSelectedPane(preferredPane);
    await loadWorkspaceTree(payload.activeWorkspaceId);
    await loadFailedTasks();
    await loadLastStartupCheck();
    await loadNxRouter();
    await loadOfficePresets();
    await loadVoiceAssignments();
    setStatusMessage(payload.onboardingRequired ? "First run: Add a provider in Nexus Router to get started." : "Ready");
  }, []);

  async function loadNxRouter() {
    try {
      const [provRes, cfgRes] = await Promise.all([
        fetch("/api/router/providers"),
        fetch("/api/router/config"),
      ]);
      if (provRes.ok) {
        const data = (await provRes.json()) as { providers: NxProvider[] };
        setNxProviders(data.providers);
        const modelMap: Record<string, string[]> = {};
        for (const provider of data.providers) {
          modelMap[provider.id] = provider.models ?? [];
        }
        setNxModelOptionsByProvider(modelMap);
      }
      if (cfgRes.ok) {
        const data = (await cfgRes.json()) as NxRouterConfig;
        setNxRetryEditor(data.retryPolicy);
        setNxFallbackRows(data.fallbackChain.length > 0
          ? data.fallbackChain.map((target) => createFallbackRow(target))
          : [createFallbackRow()]);
        const assignments: Record<string, string[]> = {};
        for (const [harnessId, targets] of Object.entries(data.harnessAssignments ?? {})) {
          assignments[harnessId] = targets.map(fallbackKey);
        }
        setNxHarnessAssignments(assignments);
        setNxConsoleLogs(data.logs);
      }
    } catch { /* silent */ }
  }

  async function loadOfficePresets() {
    const response = await fetch("/api/tools/officecli/presets");
    if (!response.ok) {
      return;
    }
    const payload = (await response.json()) as { presets?: Array<{ id: string; label: string; description: string; args: string[] }> };
    setOfficePresets(payload.presets ?? []);
  }

  async function saveStartupStrictMode(enabled: boolean) {
    setStartupStrictModeSaving(true);
    const response = await fetch("/api/startup/strict-mode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    if (!response.ok) {
      setStatusMessage("Failed to update strict startup mode.");
      setStartupStrictModeSaving(false);
      return;
    }
    setStartupStrictMode(enabled);
    setStartupStrictModeSaving(false);
    setStatusMessage(`Strict startup mode ${enabled ? "enabled" : "disabled"}.`);
  }

  async function runOfficePreset() {
    if (!officePresetDraft.harnessId || !officePresetDraft.file.trim()) {
      setStatusMessage("Select harness and file path for Office preset.");
      return;
    }
    setOfficePresetBusy(true);
    const response = await fetch("/api/tools/officecli/run-preset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(officePresetDraft),
    });
    if (!response.ok) {
      const payload = (await response.json()) as { error?: string };
      setStatusMessage(payload.error ?? "Office preset run failed.");
    } else {
      setStatusMessage("Office preset executed.");
      await loadWebCapabilityDiagnostics();
    }
    setOfficePresetBusy(false);
  }

  async function loadHarnessCapabilities(harnessId: string) {
    const response = await fetch(`/api/harnesses/${encodeURIComponent(harnessId)}/capabilities`);
    if (!response.ok) {
      return;
    }

    const payload = (await response.json()) as { capabilities: HarnessCapabilitySettings };
    setHarnessCapabilitiesByHarness((current) => ({
      ...current,
      [harnessId]: payload.capabilities ?? defaultHarnessCapabilities(),
    }));
  }

  async function saveHarnessCapabilities(harnessId: string) {
    const capabilities = harnessCapabilitiesByHarness[harnessId] ?? defaultHarnessCapabilities();
    setHarnessCapabilitySavingId(harnessId);
    const response = await fetch(`/api/harnesses/${encodeURIComponent(harnessId)}/capabilities`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(capabilities),
    });
    if (!response.ok) {
      setStatusMessage("Failed to save harness extra settings.");
      pushToast("Harness settings save failed.", "err");
    } else {
      setStatusMessage("Harness extra settings saved.");
      pushToast("Harness settings saved.", "ok");
    }
    setHarnessCapabilitySavingId(null);
  }

  useEffect(() => {
    if (nxAutoSyncStarted.current || nxProviders.length === 0) {
      return;
    }

    nxAutoSyncStarted.current = true;
    void Promise.all(
      nxProviders
        .filter((provider) => provider.enabled)
        .map((provider) => nxSyncModels(provider.id)),
    );
  }, [nxProviders]);

  async function nxSaveProvider(event: FormEvent) {
    event.preventDefault();
    setNxSaving(true);
    try {
      const res = await fetch("/api/router/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nxProviderForm),
      });
      if (res.ok) {
        await loadNxRouter();
        setStatusMessage(`Provider "${nxProviderForm.name}" saved.`);
      } else {
        const err = (await res.json()) as { error: string };
        setStatusMessage(err.error);
      }
    } finally {
      setNxSaving(false);
    }
  }

  async function nxSyncModels(providerId: string) {
    setNxSyncingId(providerId);
    try {
      if (providerId === "cookbook") {
        await loadCookbookSnapshot();
        setStatusMessage("Cookbook models refreshed.");
        return;
      }

      const res = await fetch(`/api/router/models?providerId=${encodeURIComponent(providerId)}`);
      if (res.ok) {
        const payload = (await res.json()) as { models?: string[] };
        if (Array.isArray(payload.models)) {
          setNxModelOptionsByProvider((current) => ({ ...current, [providerId]: payload.models ?? [] }));
        }
        await loadNxRouter();
        setStatusMessage(`Models synced for ${providerId}.`);
      } else {
        const err = (await res.json()) as { error: string };
        setStatusMessage(err.error);
      }
    } finally {
      setNxSyncingId(null);
    }
  }

  async function nxSaveConfig() {
    setNxConfigSaving(true);
    const fallbackChain = nxFallbackRows
      .map((row) => ({ providerId: row.providerId.trim(), model: row.model.trim() }))
      .filter((row) => row.providerId && row.model);

    const harnessAssignments: Record<string, NxFallbackTarget[]> = {};
    for (const [harnessId, selected] of Object.entries(nxHarnessAssignments)) {
      const parsed = selected
        .filter((entry) => fallbackChoiceSet.has(entry))
        .map(parseFallbackKey)
        .filter((entry): entry is NxFallbackTarget => Boolean(entry));
      if (parsed.length > 0) {
        harnessAssignments[harnessId] = parsed;
      }
    }

    const res = await fetch("/api/router/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fallbackChain, harnessAssignments, retryPolicy: nxRetryEditor }),
    });
    if (res.ok) {
      await loadNxRouter();
      setStatusMessage("Router config saved.");
      pushToast("Router config saved.", "ok");
    } else {
      pushToast("Failed to save router config.", "err");
    }
    setNxConfigSaving(false);
  }

  async function nxTestChat() {
    setNxTestBusy(true);
    setNxTestResult(null);
    try {
      const res = await fetch("/api/router/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", content: nxTestPrompt }] }),
      });
      const data = await res.json();
      if (res.ok) {
        setNxTestResult(data as typeof nxTestResult);
        setStatusMessage(`Test routed via ${(data as { providerId: string }).providerId}`);
      } else {
        setStatusMessage((data as { error: string }).error ?? "Router chat failed");
      }
    } finally {
      setNxTestBusy(false);
      await loadNxRouter();
    }
  }

  async function loadLastStartupCheck() {
    const response = await fetch("/api/startup/check/last");
    const payload = (await response.json()) as { last: { readiness: StartupReadiness; timestamp: string } | null };
    setLastStartupCheck(payload.last);
  }

  async function loadWebCapabilityDiagnostics() {
    setWebCapabilityDiagnosticsBusy(true);
    const response = await fetch("/api/tools/web-capabilities/diagnostics");
    if (!response.ok) {
      setWebCapabilityDiagnosticsBusy(false);
      return;
    }
    const payload = (await response.json()) as WebCapabilityDiagnostics;
    setWebCapabilityDiagnostics(payload);
    setWebCapabilityDiagnosticsBusy(false);
  }

  async function loadFailedTasks() {
    const response = await fetch("/api/chat/tasks/resumable");
    const payload = (await response.json()) as { tasks: FailedTask[] };
    setFailedTasks(payload.tasks);
  }

  useEffect(() => {
    // Initial app hydration intentionally seeds UI state from backend bootstrap.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadBootstrap();
  }, [loadBootstrap]);

  useEffect(() => {
    if (rightTab !== "diagnostics") {
      return;
    }
    void loadWebCapabilityDiagnostics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rightTab]);

  useEffect(() => {
    if (selectedPane.type !== "agent") {
      return;
    }
    void loadHarnessCapabilities(selectedPane.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPane.type, selectedPane.id]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", themeId);
    window.localStorage.setItem("nexus-theme", themeId);
  }, [themeId]);

  function pushToast(message: string, tone: "ok" | "warn" | "err" = "ok") {
    const id = crypto.randomUUID();
    setToasts((current) => [...current, { id, message, tone }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((t) => t.id !== id));
    }, 3500);
  }

  useEffect(() => {
    window.localStorage.setItem("nexus-github-client-id", githubClientId);
  }, [githubClientId]);

  useEffect(() => {
    if (selectedPane.type === "agent") {
      void loadHarnessThreads(selectedPane.id);
      void loadHarnessSchedules(selectedPane.id);
      void loadHarnessRuns(selectedPane.id);
    }
    if (selectedPane.type === "tool" && selectedPane.id === "cookbook") {
      void loadCookbookSnapshot();
      void loadRuntimeJobs();
    }
    if (selectedPane.type === "tool" && selectedPane.id === "voice-studio") {
      void loadVoiceStatus();
      void loadRuntimeJobs();
    }
    if (selectedPane.type === "tool" && selectedPane.id === "music-generator") {
      void loadStableAudioStatus();
    }
    if (selectedPane.type === "tool" && selectedPane.id === "image-generator") {
      void loadWan2GpStatus();
    }
    if (selectedPane.type === "tool" && selectedPane.id === "media-center") {
      void loadVoiceStatus();
      void loadStableAudioStatus();
      void loadWan2GpStatus();
      void loadHunyuan3dStatus();
    }
    if (selectedPane.type === "tool" && selectedPane.id === "settings") {
      void loadGitStatus();
      void loadGitHubConnectorStatus();
    }
  }, [selectedPane, boot?.activeWorkspaceId]);

  useEffect(() => {
    const hasActive = runtimeJobs.some((job) => job.status === "queued" || job.status === "running" || job.status === "canceling");
    if (!hasActive) {
      return;
    }

    const timer = window.setInterval(() => {
      void loadRuntimeJobs();
      void loadRuntimeStatus();
    }, 2000);

    return () => {
      window.clearInterval(timer);
    };
  }, [runtimeJobs]);

  function getHarnessSubTab(harnessId: string): HarnessSubTab {
    return harnessSubTabByHarness[harnessId] ?? "chats";
  }

  function renderMediaCenterTabs() {
    return (
      <div className="tool-tabs" role="tablist" aria-label="Media generators">
        <button type="button" className={`tool-tab ${mediaCenterTab === "voice" ? "active" : ""}`} onClick={() => setMediaCenterTab("voice")}>Voice</button>
        <button type="button" className={`tool-tab ${mediaCenterTab === "music" ? "active" : ""}`} onClick={() => setMediaCenterTab("music")}>Music</button>
        <button type="button" className={`tool-tab ${mediaCenterTab === "image" ? "active" : ""}`} onClick={() => setMediaCenterTab("image")}>Image</button>
        <button type="button" className={`tool-tab ${mediaCenterTab === "video" ? "active" : ""}`} onClick={() => setMediaCenterTab("video")}>Video</button>
        <button type="button" className={`tool-tab ${mediaCenterTab === "models" ? "active" : ""}`} onClick={() => setMediaCenterTab("models")}>3D Models</button>
      </div>
    );
  }

  function getScheduleDraft(harnessId: string): { title: string; prompt: string; intervalMinutes: number } {
    return scheduleDraftByHarness[harnessId] ?? {
      title: "",
      prompt: "",
      intervalMinutes: 30,
    };
  }

  function getEditingScheduleId(harnessId: string): string | null {
    return editingScheduleIdByHarness[harnessId] ?? null;
  }

  async function loadHarnessSchedules(harnessId: string, workspaceId?: string) {
    const activeWorkspaceId = workspaceId ?? boot?.activeWorkspaceId ?? "default";
    const response = await fetch(`/api/harnesses/${encodeURIComponent(harnessId)}/schedules?workspaceId=${encodeURIComponent(activeWorkspaceId)}`);
    if (!response.ok) {
      return;
    }
    const payload = (await response.json()) as { schedules: HarnessSchedule[] };
    setHarnessSchedulesByHarness((current) => ({ ...current, [harnessId]: payload.schedules ?? [] }));
  }

  async function loadHarnessRuns(harnessId: string, workspaceId?: string) {
    const activeWorkspaceId = workspaceId ?? boot?.activeWorkspaceId ?? "default";
    const response = await fetch(`/api/harnesses/${encodeURIComponent(harnessId)}/runs?workspaceId=${encodeURIComponent(activeWorkspaceId)}`);
    if (!response.ok) {
      return;
    }
    const payload = (await response.json()) as { runs: HarnessRunRecord[] };
    setHarnessRunsByHarness((current) => ({ ...current, [harnessId]: payload.runs ?? [] }));
  }

  async function onCreateSchedule(harnessId: string) {
    const draft = getScheduleDraft(harnessId);
    const editingId = getEditingScheduleId(harnessId);
    if (!draft.prompt.trim()) {
      setStatusMessage("Schedule prompt is required.");
      return;
    }

    setScheduleBusyHarnessId(harnessId);
    const response = editingId
      ? await fetch(`/api/harnesses/${encodeURIComponent(harnessId)}/schedules/${encodeURIComponent(editingId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: boot?.activeWorkspaceId ?? "default",
          title: draft.title,
          prompt: draft.prompt,
          intervalMinutes: draft.intervalMinutes,
        }),
      })
      : await fetch(`/api/harnesses/${encodeURIComponent(harnessId)}/schedules`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: boot?.activeWorkspaceId ?? "default",
          title: draft.title,
          prompt: draft.prompt,
          intervalMinutes: draft.intervalMinutes,
          enabled: true,
        }),
      });

    if (!response.ok) {
      const payload = (await response.json()) as { error?: string };
      setStatusMessage(payload.error ?? "Failed to create schedule");
      setScheduleBusyHarnessId(null);
      return;
    }

    setScheduleDraftByHarness((current) => ({
      ...current,
      [harnessId]: { title: "", prompt: "", intervalMinutes: draft.intervalMinutes },
    }));
    setEditingScheduleIdByHarness((current) => ({ ...current, [harnessId]: null }));
    await loadHarnessSchedules(harnessId);
    setStatusMessage(editingId ? "Schedule updated." : "Schedule saved.");
    setScheduleBusyHarnessId(null);
  }

  async function onToggleSchedule(harnessId: string, scheduleId: string, enabled: boolean) {
    setScheduleBusyHarnessId(harnessId);
    const response = await fetch(`/api/harnesses/${encodeURIComponent(harnessId)}/schedules/${encodeURIComponent(scheduleId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceId: boot?.activeWorkspaceId ?? "default",
        enabled,
      }),
    });

    if (!response.ok) {
      const payload = (await response.json()) as { error?: string };
      setStatusMessage(payload.error ?? "Failed to update schedule");
      setScheduleBusyHarnessId(null);
      return;
    }

    await loadHarnessSchedules(harnessId);
    setStatusMessage(enabled ? "Schedule enabled." : "Schedule paused.");
    setScheduleBusyHarnessId(null);
  }

  async function onDeleteSchedule(harnessId: string, scheduleId: string) {
    setScheduleBusyHarnessId(harnessId);
    const workspaceId = boot?.activeWorkspaceId ?? "default";
    const response = await fetch(`/api/harnesses/${encodeURIComponent(harnessId)}/schedules/${encodeURIComponent(scheduleId)}?workspaceId=${encodeURIComponent(workspaceId)}`, {
      method: "DELETE",
    });

    if (!response.ok) {
      const payload = (await response.json()) as { error?: string };
      setStatusMessage(payload.error ?? "Failed to delete schedule");
      setScheduleBusyHarnessId(null);
      return;
    }

    await loadHarnessSchedules(harnessId);
    setStatusMessage("Schedule deleted.");
    setScheduleBusyHarnessId(null);
  }

  async function onManualRun(harnessId: string) {
    const draft = getScheduleDraft(harnessId);
    if (!draft.prompt.trim()) {
      setStatusMessage("Manual run prompt is required.");
      return;
    }

    setManualRunBusyHarnessId(harnessId);
    const response = await fetch(`/api/harnesses/${encodeURIComponent(harnessId)}/runs/manual`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceId: boot?.activeWorkspaceId ?? "default",
        prompt: draft.prompt,
      }),
    });

    if (!response.ok) {
      const payload = (await response.json()) as { error?: string };
      setStatusMessage(payload.error ?? "Manual run failed");
      setManualRunBusyHarnessId(null);
      return;
    }

    await loadHarnessRuns(harnessId);
    setStatusMessage("Manual run completed.");
    setManualRunBusyHarnessId(null);
  }

  async function loadWorkspaceTree(workspaceId: string) {
    const response = await fetch(`/api/workspaces/${workspaceId}/tree`);
    const payload = (await response.json()) as { tree: WorkspaceTreeNode };
    setWorkspaceTree(payload.tree);
  }

  async function refreshActiveWorkspaceTree(workspaceId?: string) {
    const resolvedWorkspaceId = workspaceId ?? boot?.activeWorkspaceId ?? "default";
    try {
      await loadWorkspaceTree(resolvedWorkspaceId);
    } catch {
      // Keep chat flow resilient even if tree refresh fails.
    }
  }

  async function loadGitStatus() {
    setGitBusyAction("refresh");
    const response = await fetch("/api/tools/git/status");
    if (!response.ok) {
      const payload = (await response.json()) as { error?: string };
      setStatusMessage(payload.error ?? "Failed to load Git status.");
      setGitBusyAction(null);
      return;
    }

    const payload = (await response.json()) as GitStatusPayload;
    setGitStatus(payload);
    setGitBusyAction(null);
  }

  async function loadGitHubConnectorStatus() {
    setGithubBusy("refresh");
    const response = await fetch("/api/tools/connectors/github/status");
    if (!response.ok) {
      const payload = (await response.json()) as { error?: string };
      setStatusMessage(payload.error ?? "Failed to load GitHub connector status.");
      setGithubBusy(null);
      return;
    }
    const payload = (await response.json()) as GitHubConnectorStatus;
    setGithubConnector(payload);
    setGithubBusy(null);
  }

  async function startGitHubDeviceFlow() {
    const clientId = githubClientId.trim();
    if (!clientId) {
      setGithubInlineError("Enter a GitHub OAuth app client ID before connecting.");
      pushToast("GitHub OAuth client ID is required.", "warn");
      return;
    }
    setGithubInlineError(null);

    setGithubBusy("device-start");
    const response = await fetch("/api/tools/connectors/github/device/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId, scopes: ["repo"] }),
    });

    if (!response.ok) {
      const payload = (await response.json()) as { error?: string };
      const errMsg = payload.error ?? "GitHub device flow could not start.";
      setStatusMessage(errMsg);
      setGithubInlineError(errMsg);
      pushToast(errMsg, "err");
      setGithubBusy(null);
      return;
    }

    const payload = (await response.json()) as {
      device: {
        device_code: string;
        user_code: string;
        verification_uri: string;
        verification_uri_complete?: string;
        interval: number;
        expires_in: number;
      };
      clientId: string;
      scopes: string[];
    };

    const expiresAt = Date.now() + (payload.device.expires_in * 1000);
    setGithubDeviceFlow({
      clientId: payload.clientId,
      deviceCode: payload.device.device_code,
      userCode: payload.device.user_code,
      verificationUri: payload.device.verification_uri,
      verificationUriComplete: payload.device.verification_uri_complete,
      interval: payload.device.interval || 5,
      expiresAt,
      scopes: payload.scopes,
    });
    setGithubInlineError(null);
    setStatusMessage(`GitHub device code ready. Open the verification page and enter ${payload.device.user_code}.`);
    pushToast(`Enter code ${payload.device.user_code} at ${payload.device.verification_uri}`, "ok");
    if (payload.device.verification_uri_complete) {
      window.open(payload.device.verification_uri_complete, "_blank", "noopener,noreferrer");
    } else {
      window.open(payload.device.verification_uri, "_blank", "noopener,noreferrer");
    }
    setGithubBusy(null);

    const pollUntilConnected = async () => {
      const flow = {
        clientId: payload.clientId,
        deviceCode: payload.device.device_code,
        userCode: payload.device.user_code,
        verificationUri: payload.device.verification_uri,
        verificationUriComplete: payload.device.verification_uri_complete,
        interval: payload.device.interval || 5,
        expiresAt,
        scopes: payload.scopes,
      };
      let pollInterval = Math.max(3, flow.interval) * 1000;

      while (Date.now() < flow.expiresAt) {
        setGithubBusy("device-poll");
        const pollResponse = await fetch("/api/tools/connectors/github/device/poll", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clientId: flow.clientId, deviceCode: flow.deviceCode }),
        });

        if (pollResponse.ok) {
          const pollPayload = (await pollResponse.json()) as { connector: GitHubConnectorStatus };
          setGithubConnector(pollPayload.connector);
          setGithubDeviceFlow(null);
          setGithubBusy(null);
          setGithubInlineError(null);
          const loginMsg = `GitHub connected as ${pollPayload.connector.login ?? "unknown"}.`;
          setStatusMessage(loginMsg);
          pushToast(loginMsg, "ok");
          return;
        }

        if (pollResponse.status === 202) {
          const pollPayload = (await pollResponse.json()) as { interval?: number };
          pollInterval = Math.max(3, pollPayload.interval ?? flow.interval) * 1000;
          await new Promise((resolve) => window.setTimeout(resolve, pollInterval));
          continue;
        }

        const pollPayload = (await pollResponse.json()) as { error?: string };
        if (pollResponse.status === 410) {
          setStatusMessage(pollPayload.error ?? "GitHub device flow expired.");
          break;
        }

        setStatusMessage(pollPayload.error ?? "GitHub device flow failed.");
        break;
      }

      setGithubBusy(null);
      if (Date.now() >= expiresAt) {
        setStatusMessage("GitHub device flow expired before approval.");
      }
    };

    void pollUntilConnected();
  }

  async function connectGitHubConnector() {
    const token = githubTokenDraft.trim();
    if (!token) {
      setStatusMessage("Paste a GitHub token to connect.");
      return;
    }

    setGithubBusy("connect");
    const response = await fetch("/api/tools/connectors/github/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });

    if (!response.ok) {
      const payload = (await response.json()) as { error?: string };
      setStatusMessage(payload.error ?? "GitHub connector login failed.");
      setGithubBusy(null);
      return;
    }

    const payload = (await response.json()) as { connector: GitHubConnectorStatus };
    setGithubConnector(payload.connector);
    setGithubTokenDraft("");
    setGithubInlineError(null);
    setStatusMessage("GitHub connected.");
    pushToast("GitHub connected.", "ok");
    setGithubBusy(null);
  }

  async function disconnectGitHubConnector() {
    setGithubBusy("disconnect");
    const response = await fetch("/api/tools/connectors/github/disconnect", {
      method: "POST",
    });

    if (!response.ok) {
      const payload = (await response.json()) as { error?: string };
      setStatusMessage(payload.error ?? "Failed to disconnect GitHub.");
      setGithubBusy(null);
      return;
    }

    const payload = (await response.json()) as { connector: GitHubConnectorStatus };
    setGithubConnector(payload.connector);
    setStatusMessage("GitHub disconnected.");
    pushToast("GitHub disconnected.", "warn");
    setGithubBusy(null);
  }

  async function runGitCommit() {
    const message = gitCommitMessage.trim();
    if (message.length < 3) {
      setStatusMessage("Commit message must be at least 3 characters.");
      return;
    }

    setGitBusyAction("commit");
    const response = await fetch("/api/tools/git/commit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });

    if (!response.ok) {
      const payload = (await response.json()) as { error?: string };
      setStatusMessage(payload.error ?? "Git commit failed.");
      setGitBusyAction(null);
      return;
    }

    const payload = (await response.json()) as { status: GitStatusPayload };
    setGitStatus(payload.status);
    setStatusMessage("Committed workspace changes.");
    setGitBusyAction(null);
  }

  async function runGitPush() {
    setGitBusyAction("push");
    const response = await fetch("/api/tools/git/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    if (!response.ok) {
      const payload = (await response.json()) as { error?: string };
      setStatusMessage(payload.error ?? "Git push failed.");
      setGitBusyAction(null);
      return;
    }

    const payload = (await response.json()) as { status: GitStatusPayload; usedGithubConnector?: boolean };
    setGitStatus(payload.status);
    setStatusMessage(payload.usedGithubConnector ? "Pushed via GitHub connector." : "Pushed current branch to origin.");
    setGitBusyAction(null);
  }

  async function onRunStartupCheck() {
    setStartupChecking(true);
    setStatusMessage("Running startup check...");
    const response = await fetch("/api/startup/check");
    const payload = (await response.json()) as StartupCheckPayload;

    setBoot((current) => {
      if (!current) {
        return current;
      }
      return {
        ...current,
        startup: payload.startup,
      };
    });

    setStartupCheckDetails(payload);
    if (payload.runtimeStatus) {
      setRuntimeStatus(payload.runtimeStatus);
    }

    setStatusMessage(payload.startup.ready ? "Startup checks passed" : "Startup checks found blockers");
    setStartupChecking(false);
    await loadLastStartupCheck();
    await loadWebCapabilityDiagnostics();
  }

  async function onSendMessage(resendText?: string) {
    const textToSend = (resendText ?? composer).trim();
    if (!activeHarness || !textToSend || chatBusy) {
      return;
    }

    const harnessId = activeHarness.id;
    const workspaceIdForRequest = boot?.activeWorkspaceId ?? "default";
    const threadId = ensureHarnessThread(harnessId);
    const threadMessages = (chatThreadsByHarness[harnessId] ?? []).find((thread) => thread.id === threadId)?.messages ?? [];

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: textToSend,
      createdAt: new Date().toISOString(),
    };

    const assistantPlaceholder: ChatMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: "",
      createdAt: new Date().toISOString(),
    };

    const nextHistory = [...threadMessages, userMessage];
    let threadSnapshot: HarnessChatThread = {
      id: threadId,
      title: threadMessages.length === 0 ? textToSend.slice(0, 42) : ((chatThreadsByHarness[harnessId] ?? []).find((t) => t.id === threadId)?.title ?? "New chat"),
      messages: [...nextHistory, assistantPlaceholder],
      meta: null,
      createdAt: (chatThreadsByHarness[harnessId] ?? []).find((t) => t.id === threadId)?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    upsertThread(harnessId, threadId, () => threadSnapshot);
    await saveHarnessThread(harnessId, threadSnapshot);
    setComposer("");
    setStreamTrace("");
    setStreamTraceOpen(false);
    setChatBusy(true);
    setStatusMessage(`Routing ${activeHarness.name} via Nexus Router...`);
    const requestId = crypto.randomUUID();
    setActiveRequestId(requestId);

    const response = await fetch("/api/chat/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        harnessId: activeHarness.id,
        message: userMessage.content,
        history: nextHistory,
        requestId,
      }),
    });

    if (!response.ok) {
      const payload = (await response.json()) as { error?: string };
      setStatusMessage(payload.error ?? "Chat request failed");
      setChatBusy(false);
      setActiveRequestId(null);
      await saveHarnessThread(harnessId, threadSnapshot);
      await refreshActiveWorkspaceTree(workspaceIdForRequest);
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      setStatusMessage("Unable to stream response");
      setChatBusy(false);
      setActiveRequestId(null);
      await saveHarnessThread(harnessId, threadSnapshot);
      await refreshActiveWorkspaceTree(workspaceIdForRequest);
      return;
    }

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      while (true) {
        const split = buffer.indexOf("\n\n");
        if (split === -1) {
          break;
        }

        const frame = buffer.slice(0, split);
        buffer = buffer.slice(split + 2);
        const dataLine = frame
          .split("\n")
          .find((line) => line.startsWith("data:"));

        if (!dataLine) {
          continue;
        }

        const raw = dataLine.slice(5).trim();
        let envelope: StreamEnvelope;

        try {
          envelope = JSON.parse(raw) as StreamEnvelope;
        } catch {
          continue;
        }

        if (envelope.type === "meta") {
          threadSnapshot = {
            ...threadSnapshot,
            meta: envelope.meta,
            updatedAt: new Date().toISOString(),
          };
          upsertThread(harnessId, threadId, () => threadSnapshot);
          continue;
        }

        if (envelope.type === "delta") {
          setStreamTrace((current) => `${current}${envelope.text}`.slice(-8000));
          threadSnapshot = {
            ...threadSnapshot,
            messages: threadSnapshot.messages.map((entry) =>
              entry.id === assistantPlaceholder.id
                ? { ...entry, content: `${entry.content}${envelope.text}` }
                : entry,
            ),
            updatedAt: new Date().toISOString(),
          };
          upsertThread(harnessId, threadId, () => threadSnapshot);
          continue;
        }

        if (envelope.type === "error") {
          setStatusMessage(envelope.message);
          setStreamTrace((current) => `${current}\n[error] ${envelope.message}`.slice(-8000));
          continue;
        }

        if (envelope.type === "done") {
          await saveHarnessThread(harnessId, threadSnapshot);
          setChatBusy(false);
          setActiveRequestId(null);
          setStatusMessage("Ready");
          await refreshActiveWorkspaceTree(workspaceIdForRequest);
        }
      }
    }

    await saveHarnessThread(harnessId, threadSnapshot);
    setChatBusy(false);
    setActiveRequestId(null);
    const finalAssistant = threadSnapshot.messages.find((entry) => entry.id === assistantPlaceholder.id)?.content ?? "";
    if (finalAssistant.trim()) {
      void speakHarnessReplyIfAssigned(harnessId, finalAssistant);
    }
    await refreshActiveWorkspaceTree(workspaceIdForRequest);
    setStatusMessage("Ready");
  }

  async function onStopStream() {
    if (!activeRequestId) {
      return;
    }

    await fetch("/api/chat/stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId: activeRequestId }),
    });

    setChatBusy(false);
    setActiveRequestId(null);
    setStatusMessage("Streaming stopped");
  }

  async function onCopyMessage(content: string) {
    try {
      await navigator.clipboard.writeText(content);
      setStatusMessage("Message copied.");
    } catch {
      setStatusMessage("Copy failed.");
    }
  }

  async function loadWorkspaceRoots() {
    setWorkspaceBrowseBusy(true);
    const response = await fetch("/api/workspaces/browse/roots");
    if (!response.ok) {
      setWorkspaceBrowseBusy(false);
      return;
    }
    const payload = (await response.json()) as { roots: string[] };
    const roots = payload.roots ?? [];
    setWorkspaceRoots(roots);
    setWorkspaceBrowseBusy(false);
  }

  async function browseWorkspacePath(targetPath: string) {
    if (!targetPath) {
      return;
    }
    setWorkspaceBrowseBusy(true);
    const response = await fetch(`/api/workspaces/browse?path=${encodeURIComponent(targetPath)}`);
    if (!response.ok) {
      const payload = (await response.json()) as { error?: string };
      setStatusMessage(payload.error ?? "Failed to browse folder");
      setWorkspaceBrowseBusy(false);
      return;
    }

    const payload = (await response.json()) as {
      path: string;
      parentPath: string | null;
      folders: WorkspaceFolderEntry[];
    };
    setWorkspaceBrowsePath(payload.path);
    setWorkspaceBrowseParentPath(payload.parentPath);
    setWorkspaceBrowseFolders(payload.folders ?? []);
    setWorkspaceBrowseBusy(false);
  }

  async function openWorkspaceBrowser() {
    setWorkspaceBrowserOpen(true);
    await loadWorkspaceRoots();
    if (workspacePathDraft) {
      await browseWorkspacePath(workspacePathDraft);
    }
  }

  function closeWorkspaceBrowser() {
    setWorkspaceBrowserOpen(false);
  }

  async function onCreateWorkspace(event: FormEvent) {
    event.preventDefault();
    if (createWorkspaceName.trim().length < 2) {
      return;
    }
    const response = await fetch("/api/workspaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: createWorkspaceName.trim(),
        workspacePath: workspacePathDraft.trim() || undefined,
      }),
    });

    if (!response.ok) {
      const payload = (await response.json()) as { error?: string };
      setStatusMessage(payload.error ?? "Failed to create workspace");
      return;
    }

    setCreateWorkspaceName("");
    setWorkspacePathDraft("");
    setWorkspaceBrowserOpen(false);
    await loadBootstrap();
  }

  async function onSwitchWorkspace(workspaceId: string) {
    await fetch("/api/workspaces/switch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: workspaceId }),
    });
    await loadBootstrap();
    await loadWorkspaceTree(workspaceId);
    if (selectedPane.type === "agent") {
      await Promise.all([
        loadHarnessThreads(selectedPane.id, workspaceId),
        loadHarnessSchedules(selectedPane.id, workspaceId),
        loadHarnessRuns(selectedPane.id, workspaceId),
      ]);
    }
  }

  async function onDeleteWorkspace(workspaceId: string) {
    if (workspaceId === "default") {
      return;
    }
    await fetch(`/api/workspaces/${workspaceId}`, { method: "DELETE" });
    await loadBootstrap();
  }

  async function onResumeTask(task: FailedTask) {
    if (resumeBusyId) {
      return;
    }

    setResumeBusyId(task.requestId);
    setStatusMessage(`Resuming failed task ${task.requestId.slice(0, 8)}...`);

    const response = await fetch(`/api/chat/tasks/${task.requestId}/resume`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    if (!response.ok) {
      const payload = (await response.json()) as { error?: string };
      setStatusMessage(payload.error ?? "Failed to resume task");
      setResumeBusyId(null);
      return;
    }

    const payload = (await response.json()) as {
      content: string;
      meta: ChatMeta;
      requestId: string;
    };

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: task.message,
      createdAt: task.startedAt,
    };

    const assistantMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: `${task.partialOutput}${payload.content}`,
      createdAt: new Date().toISOString(),
    };

    const resumedThread: HarnessChatThread = {
      id: crypto.randomUUID(),
      title: task.message.slice(0, 42),
      messages: [userMessage, assistantMessage],
      meta: payload.meta,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setChatThreadsByHarness((current) => ({
      ...current,
      [task.harnessId]: [resumedThread, ...(current[task.harnessId] ?? [])],
    }));
    setActiveThreadByHarness((current) => ({ ...current, [task.harnessId]: resumedThread.id }));
    await saveHarnessThread(task.harnessId, resumedThread, task.workspaceId);
    setSelectedPane({ type: "agent", id: task.harnessId });
    setStatusMessage("Task resumed and merged into chat view.");
    setResumeBusyId(null);
    await loadFailedTasks();
  }

  function formatCheckAge(timestamp: string): { label: string; ageClass: string } {
    const ageMs = Date.now() - new Date(timestamp).getTime();
    const ageMins = Math.floor(ageMs / 60_000);
    if (ageMins < 1) return { label: "just now", ageClass: "age-fresh" };
    if (ageMins < 10) return { label: `${ageMins}m ago`, ageClass: "age-fresh" };
    if (ageMins < 60) return { label: `${ageMins}m ago`, ageClass: "age-stale" };
    const ageHrs = Math.floor(ageMins / 60);
    return { label: `${ageHrs}h ago`, ageClass: "age-old" };
  }

  function treeNodeIcon(node: WorkspaceTreeNode): string {
    if (node.type === "directory") {
      return "📁";
    }

    const extension = node.path.split(".").pop()?.toLowerCase() ?? "";
    if (["png", "jpg", "jpeg", "webp", "gif", "bmp", "svg"].includes(extension)) {
      return "🖼️";
    }
    if (["mp3", "wav", "ogg", "flac", "m4a", "aac"].includes(extension)) {
      return "🎵";
    }
    if (["mp4", "webm", "mov", "mkv", "avi"].includes(extension)) {
      return "🎬";
    }
    if (["glb", "gltf", "obj", "fbx", "blend"].includes(extension)) {
      return "🧊";
    }
    return "📄";
  }

  function renderTree(node: WorkspaceTreeNode): ReactElement {
    return (
      <li key={node.path} className={`tree-node ${node.type}`}>
        <span>{treeNodeIcon(node)} {node.name}</span>
        {node.children && node.children.length > 0 ? <ul>{node.children.map(renderTree)}</ul> : null}
      </li>
    );
  }

  const onboardingRequired = boot?.onboardingRequired ?? true;
  const startupReady = boot?.startup.ready ?? false;
  const startupBlockers = boot?.startup.blockers ?? [];
  const connectorCards: ConnectorCard[] = [
    { id: "github", name: "GitHub", connected: Boolean(githubConnector?.connected), kind: "oauth" },
    { id: "gmail", name: "Gmail", connected: false, kind: "oauth" },
    { id: "slack", name: "Slack", connected: false, kind: "token" },
    { id: "discord", name: "Discord", connected: false, kind: "token" },
    { id: "notion", name: "Notion", connected: false, kind: "token" },
    { id: "dropbox", name: "Dropbox", connected: false, kind: "oauth" },
  ];
  const diagnosticsAlertCount = failedTasks.length + (startupReady ? 0 : Math.max(1, startupBlockers.length));
  const harnessThreads = selectedPane.type === "agent" ? (chatThreadsByHarness[selectedPane.id] ?? []) : [];
  const activeHarnessThreadId = selectedPane.type === "agent" ? activeThreadByHarness[selectedPane.id] ?? harnessThreads[0]?.id : undefined;
  const activeHarnessSubTab = selectedPane.type === "agent" ? getHarnessSubTab(selectedPane.id) : "chats";
  const activeHarnessSchedules = selectedPane.type === "agent" ? (harnessSchedulesByHarness[selectedPane.id] ?? []) : [];
  const activeHarnessRuns = selectedPane.type === "agent" ? (harnessRunsByHarness[selectedPane.id] ?? []) : [];
  const activeHarnessDraft = selectedPane.type === "agent"
    ? getScheduleDraft(selectedPane.id)
    : { title: "", prompt: "", intervalMinutes: 30 };
  const activeHarnessCapabilities = selectedPane.type === "agent"
    ? (harnessCapabilitiesByHarness[selectedPane.id] ?? defaultHarnessCapabilities())
    : defaultHarnessCapabilities();
  const activeHarnessExtrasOpen = selectedPane.type === "agent"
    ? Boolean(harnessExtrasOpenByHarness[selectedPane.id])
    : false;

  return (
    <main className="app-shell">
      <div className="orb orb-left" />
      <div className="orb orb-right" />

      {toasts.length > 0 ? (
        <div className="toast-rack" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className={`toast toast-${t.tone}`}>
              {t.tone === "ok" ? "✓" : t.tone === "err" ? "✗" : "!"}{" "}{t.message}
            </div>
          ))}
        </div>
      ) : null}

      {onboardingRequired ? (
        <section className="first-run-banner">
          <strong>First launch checkpoint:</strong> Configure Nexus Router providers to unlock all harness routing.
        </section>
      ) : null}

      {!onboardingRequired && !startupReady ? (
        <section className="first-run-banner">
          <strong>Startup blockers:</strong> {startupBlockers.join(" ")}
        </section>
      ) : null}

      <section className="pane-grid">
        <aside className="pane pane-left">
          <section className="side-brand">
            <img className="dashboard-logo" src={dashboardLogo} alt="NEXUS OS" />
            <small className="side-status">{statusMessage}</small>
          </section>

          <section className="side-nav-group">
            <div className="pane-title-row">
              <h2>Core Agents</h2>
            </div>

            <ul className="nav-list">
              {boot?.harnesses.map((harness) => {
                const isLocked = onboardingRequired;
                const isActive = selectedPane.type === "agent" && selectedPane.id === harness.id;
                return (
                  <li key={harness.id}>
                    <button
                      type="button"
                      disabled={isLocked}
                      className={`nav-item ${isActive ? "active" : ""}`}
                      onClick={() => {
                        setSelectedPane({ type: "agent", id: harness.id });
                      }}
                    >
                      <span className={`health ${harness.health}`} />
                      <span className="meta-block">
                        <strong>{harness.name}</strong>
                        <small>{harness.status} | {harnessDisplayModel[harness.id] ?? harness.defaultModel}</small>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="side-nav-group">
            <div className="pane-title-row split">
              <h2>Tools</h2>
              <button type="button" className="ghost" onClick={() => setToolsOpen((current) => !current)}>
                {toolsOpen ? "Collapse" : "Expand"}
              </button>
            </div>

            {toolsOpen ? (
              <ul className="nav-list">
                {boot?.tools.filter((tool) => tool.id !== "9router" && tool.id !== "settings").map((tool) => {
                  const isActive = selectedPane.type === "tool" && selectedPane.id === tool.id;
                  return (
                    <li key={tool.id}>
                      <button
                        type="button"
                        className={`nav-item ${isActive ? "active" : ""}`}
                        onClick={() => setSelectedPane({ type: "tool", id: tool.id })}
                      >
                        <span className={`health ${tool.status === "online" ? "healthy" : "degraded"}`} />
                        <span className="meta-block">
                          <strong>{tool.name}</strong>
                          <small>{tool.status}</small>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </section>

          <section className="side-nav-group">
            <div className="pane-title-row split">
              <h2>Orchestration</h2>
              <small className="side-group-note">coming soon</small>
            </div>
            <ul className="nav-list">
              <li>
                <button type="button" className="nav-item nav-item-placeholder" disabled>
                  <span className="health setup-required" />
                  <span className="meta-block">
                    <strong>Social Media Center</strong>
                    <small>coming soon</small>
                  </span>
                </button>
              </li>
              <li>
                <button type="button" className="nav-item nav-item-placeholder" disabled>
                  <span className="health setup-required" />
                  <span className="meta-block">
                    <strong>Game Creator</strong>
                    <small>coming soon</small>
                  </span>
                </button>
              </li>
            </ul>
          </section>

          <section className="side-nav-group">
            <div className="pane-title-row split">
              <h2>Settings/System</h2>
            </div>
            <ul className="nav-list">
              <li>
                <button
                  type="button"
                  className={`nav-item ${selectedPane.type === "tool" && selectedPane.id === "settings" ? "active" : ""}`}
                  onClick={() => setSelectedPane({ type: "tool", id: "settings" })}
                >
                  <span className="health healthy" />
                  <span className="meta-block">
                    <strong>Settings</strong>
                    <small>theme + git + connectors</small>
                  </span>
                </button>
              </li>
            </ul>
          </section>
        </aside>

        <section className="pane pane-middle">
          {selectedPane.type === "tool" && selectedPane.id === "nexus-router" ? (
            <div className="tool-view nxr-console">
              <h2>Nexus Router</h2>
              <p className="subtitle">Your own provider router — add API keys, sync models, build fallback chains.</p>

              {/* ── Provider Form ── */}
              <section className="nxr-section">
                <h3>Provider Setup</h3>
                <form className="nxr-provider-form" onSubmit={(event) => void nxSaveProvider(event)}>
                  <label>
                    Preset
                    <div className="tool-action-row tool-wrap-row">
                      <select
                        value={nxProviderForm.preset}
                        onChange={(event) => {
                          const preset = DEFAULT_PROVIDER_PRESETS.find((p) => p.id === event.target.value) ?? DEFAULT_PROVIDER_PRESETS[0];
                          setNxProviderForm((c) => ({ ...c, preset: preset.id, id: preset.id, name: preset.name, type: preset.type, baseUrl: preset.baseUrl, defaultModel: preset.defaultModel }));
                        }}
                      >
                        {DEFAULT_PROVIDER_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                      {getProviderApiKeyUrl({ id: nxProviderForm.id, name: nxProviderForm.name, baseUrl: nxProviderForm.baseUrl }) ? (
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => window.open(
                            getProviderApiKeyUrl({ id: nxProviderForm.id, name: nxProviderForm.name, baseUrl: nxProviderForm.baseUrl }) ?? "",
                            "_blank",
                            "noopener,noreferrer",
                          )}
                        >
                          Get API Key
                        </button>
                      ) : null}
                    </div>
                  </label>
                  <label>
                    Display Name
                    <input type="text" required value={nxProviderForm.name} onChange={(event) => setNxProviderForm((c) => ({ ...c, name: event.target.value }))} />
                  </label>
                  <label>
                    API Key (optional)
                    <input type="password" value={nxProviderForm.apiKey} placeholder="sk-..." onChange={(event) => setNxProviderForm((c) => ({ ...c, apiKey: event.target.value }))} />
                  </label>
                  <label>
                    Base URL
                    <input type="text" required value={nxProviderForm.baseUrl} onChange={(event) => setNxProviderForm((c) => ({ ...c, baseUrl: event.target.value }))} />
                  </label>
                  <label>
                    Default Model
                    <input type="text" value={nxProviderForm.defaultModel} onChange={(event) => setNxProviderForm((c) => ({ ...c, defaultModel: event.target.value }))} />
                  </label>
                  <button type="submit" disabled={nxSaving}>{nxSaving ? "Saving..." : "Save Provider"}</button>
                </form>
              </section>

              {/* ── Connected Providers ── */}
              {nxProviderViews.length > 0 ? (
                <section className="nxr-section">
                  <h3>Connected Providers</h3>
                  <ul className="nxr-provider-list">
                    {nxProviderViews.map((provider) => (
                      <li key={provider.id}>
                        <div className="nxr-provider-row">
                          <span className={`health ${provider.enabled ? "healthy" : "offline"}`} />
                          <div>
                            <strong>{provider.name}</strong>
                            <small>{provider.id} · {provider.isLocal ? "local" : (provider.maskedApiKey || "(no key)")} · {provider.models.length} models{provider.lastSyncedAt ? ` · synced ${new Date(provider.lastSyncedAt).toLocaleTimeString()}` : ""}</small>
                          </div>
                          <button
                            type="button"
                            className="ghost nxr-sync-btn"
                            onClick={() => void nxSyncModels(provider.id)}
                            disabled={nxSyncingId === provider.id}
                          >
                            {nxSyncingId === provider.id ? "Syncing..." : "Sync Models"}
                          </button>
                        </div>
                        {provider.models.length > 0 ? (
                          <details className="nxr-model-list">
                            <summary>{provider.models.length} models</summary>
                            <ul>{provider.models.slice(0, 30).map((m) => <li key={m}>{m}</li>)}</ul>
                          </details>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {/* ── Fallback Chain ── */}
              <section className="nxr-section">
                <div className="nxr-section-header">
                  <h3>Fallback Chain</h3>
                  <button type="button" className="ghost" onClick={() => setNxFallbackRows((rows) => [...rows, createFallbackRow()])}>Add Row</button>
                </div>
                <p className="nxr-hint">Pick provider + model per row. Model dropdown uses synced active models.</p>
                <div className="nxr-fallback-rows">
                  {nxFallbackRows.map((row, rowIndex) => {
                    const modelOptions = row.providerId === "cookbook"
                      ? cookbookModelOptions
                      : (nxModelOptionsByProvider[row.providerId] ?? nxProviderViews.find((provider) => provider.id === row.providerId)?.models ?? []);
                    const health = getFallbackRowHealth(row);
                    return (
                      <div key={row.id} className="nxr-fallback-row">
                        <select
                          value={row.providerId}
                          onChange={(event) => {
                            const providerId = event.target.value;
                            setNxFallbackRows((rows) => rows.map((entry) => entry.id === row.id ? { ...entry, providerId, model: "" } : entry));
                            if (providerId && providerId !== "cookbook" && (nxModelOptionsByProvider[providerId]?.length ?? 0) === 0) {
                              void nxSyncModels(providerId);
                            }
                          }}
                        >
                          <option value="">Select provider</option>
                          {nxProviderViews.filter((provider) => provider.enabled).map((provider) => (
                            <option key={provider.id} value={provider.id}>{provider.name}</option>
                          ))}
                        </select>
                        <select
                          value={row.model}
                          disabled={!row.providerId}
                          onChange={(event) => setNxFallbackRows((rows) => rows.map((entry) => entry.id === row.id ? { ...entry, model: event.target.value } : entry))}
                        >
                          <option value="">{row.providerId ? "Select model" : "Select provider first"}</option>
                          {modelOptions.map((model) => (
                            <option key={model} value={model}>{model}</option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => row.providerId ? void nxSyncModels(row.providerId) : undefined}
                          disabled={!row.providerId || nxSyncingId === row.providerId}
                        >
                          {nxSyncingId === row.providerId ? "Syncing..." : "Refresh"}
                        </button>
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => moveFallbackRow(row.id, -1)}
                          disabled={rowIndex === 0}
                        >
                          Up
                        </button>
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => moveFallbackRow(row.id, 1)}
                          disabled={rowIndex === nxFallbackRows.length - 1}
                        >
                          Down
                        </button>
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => setNxFallbackRows((rows) => rows.filter((entry) => entry.id !== row.id))}
                          disabled={nxFallbackRows.length <= 1}
                        >
                          Remove
                        </button>
                        <span className={`nxr-row-status ${health.tone}`}>{health.label}</span>
                      </div>
                    );
                  })}
                </div>

                <h3 className="nxr-subheading">Harness Model Assignment</h3>
                <p className="nxr-hint">Assign one or more fallback targets per harness. Only fallback rows appear here.</p>
                {fallbackChoiceOptions.length === 0 ? (
                  <p className="nxr-hint">Add at least one fallback row before assigning harness models.</p>
                ) : (
                  <div className="nxr-harness-grid">
                    {boot?.harnesses.map((harness) => {
                      const selected = nxHarnessAssignments[harness.id] ?? [];
                      return (
                        <div key={harness.id} className="nxr-harness-card">
                          <strong>{harness.name}</strong>
                          <small>{harness.id}</small>
                          <ul>
                            {fallbackChoiceOptions.map((option) => (
                              <li key={`${harness.id}-${option}`}>
                                <label>
                                  <input
                                    type="checkbox"
                                    checked={selected.includes(option)}
                                    onChange={(event) => {
                                      const checked = event.target.checked;
                                      setNxHarnessAssignments((current) => {
                                        const existing = current[harness.id] ?? [];
                                        const next = checked
                                          ? Array.from(new Set([...existing, option]))
                                          : existing.filter((entry) => entry !== option);
                                        return { ...current, [harness.id]: next };
                                      });
                                    }}
                                  />
                                  <span>{option}</span>
                                </label>
                              </li>
                            ))}
                          </ul>
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className="nxr-retry">
                  <label>
                    Max Attempts
                    <input type="number" min={1} max={8} value={nxRetryEditor.maxAttempts} onChange={(event) => setNxRetryEditor((c) => ({ ...c, maxAttempts: Number(event.target.value) }))} />
                  </label>
                  <label>
                    Backoff ms
                    <input type="number" min={0} max={5000} step={100} value={nxRetryEditor.backoffMs} onChange={(event) => setNxRetryEditor((c) => ({ ...c, backoffMs: Number(event.target.value) }))} />
                  </label>
                </div>
                <button type="button" onClick={() => void nxSaveConfig()} disabled={nxConfigSaving}>
                  {nxConfigSaving ? "Saving..." : "Save Fallback Config"}
                </button>
              </section>

              {/* ── Test Chat ── */}
              <section className="nxr-section">
                <h3>Test Route</h3>
                <div className="nxr-test-row">
                  <input type="text" value={nxTestPrompt} onChange={(event) => setNxTestPrompt(event.target.value)} placeholder="Test prompt..." />
                  <button type="button" onClick={() => void nxTestChat()} disabled={nxTestBusy}>{nxTestBusy ? "Routing..." : "Send"}</button>
                </div>
                {nxTestResult ? (
                  <div className="nxr-test-result">
                    <small>{nxTestResult.providerId} · {nxTestResult.model} · {nxTestResult.elapsedMs}ms</small>
                    <p>{nxTestResult.content}</p>
                    <details>
                      <summary>Attempts ({nxTestResult.attempts.length})</summary>
                      <ul>{nxTestResult.attempts.map((a, i) => <li key={i}>{a.status === "success" ? "✓" : "✗"} {a.providerId}/{a.model} — {a.details}</li>)}</ul>
                    </details>
                  </div>
                ) : null}
              </section>

              {/* ── Router Logs ── */}
              {nxConsoleLogs.length > 0 ? (
                <section className="nxr-section">
                  <h3>Router Logs</h3>
                  <ul className="nxr-logs">
                    {nxConsoleLogs.slice(0, 10).map((log, i) => (
                      <li key={i} className={`nxr-log-${log.level}`}>
                        <small>{new Date(log.timestamp).toLocaleTimeString()}</small> {log.message}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </div>
          ) : null}

          {selectedPane.type === "tool" && selectedPane.id === "cookbook" ? (
            <div className="tool-view tool-console">
              <div className="tool-header-row">
                <div>
                  <h2>Cookbook</h2>
                  <p className="subtitle">Scan this machine and recommend the best local fallback models when free cloud tokens run out.</p>
                </div>
                <button type="button" onClick={() => void loadCookbookSnapshot()} disabled={cookbookBusy}>
                  {cookbookBusy ? "Scanning..." : "Scan Machine"}
                </button>
              </div>

              <div className="tool-tabs" role="tablist" aria-label="Cookbook panels">
                <button
                  type="button"
                  className={`tool-tab ${cookbookTab === "overview" ? "active" : ""}`}
                  onClick={() => setCookbookTab("overview")}
                >
                  Overview
                </button>
                <button
                  type="button"
                  className={`tool-tab ${cookbookTab === "jobs" ? "active" : ""}`}
                  onClick={() => {
                    setCookbookTab("jobs");
                    void loadRuntimeJobs();
                  }}
                >
                  Runtime Jobs
                </button>
              </div>

              {cookbookTab === "jobs" ? (
                <section className="tool-section">
                  <h3>Runtime Jobs</h3>
                  {runtimeJobs.length === 0 ? (
                    <p>No runtime tasks yet.</p>
                  ) : (
                    <ul className="runtime-jobs-list">
                      {runtimeJobs.map((job) => (
                        <li key={job.id} className="runtime-job-card">
                          <div className="runtime-job-header">
                            <div>
                              <strong>{job.action}{job.model ? ` (${job.model})` : ""}</strong>
                              <small className={`runtime-job-status status-${job.status}`}>{job.status}</small>
                            </div>
                            <small>{new Date(job.updatedAt).toLocaleString()}</small>
                          </div>

                          {job.error ? <p className="runtime-job-error">{job.error}</p> : null}

                          <div className="runtime-job-actions">
                            <button
                              type="button"
                              className="ghost"
                              onClick={() => toggleRuntimeJobExpanded(job.id)}
                            >
                              {expandedRuntimeJobIds[job.id] ? "Hide Logs" : "Show Logs"}
                            </button>

                            <button
                              type="button"
                              className="ghost"
                              onClick={() => void cancelRuntimeJob(job)}
                              disabled={job.status !== "queued" && job.status !== "running" && job.status !== "canceling"}
                            >
                              {job.status === "canceling" ? "Canceling..." : "Cancel"}
                            </button>

                            <button
                              type="button"
                              onClick={() => void retryRuntimeJob(job)}
                              disabled={job.status !== "failed" && job.status !== "canceled"}
                            >
                              Retry
                            </button>
                          </div>

                          {expandedRuntimeJobIds[job.id] ? (
                            <pre className="runtime-job-log">{job.logs.join("\n") || "No logs yet."}</pre>
                          ) : (
                            <small>{job.logs[job.logs.length - 1] ?? "No logs yet."}</small>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              ) : cookbookSnapshot ? (
                <>
                  <section className="tool-section">
                    <h3>System Snapshot</h3>
                    <div className="cookbook-spec-row">
                      <span>CPU {cookbookSnapshot.machine.logicalCores}c</span>
                      <span>RAM {cookbookSnapshot.machine.totalRamGb}G ({cookbookSnapshot.machine.freeRamGb}G free)</span>
                      <span>Disk {cookbookSnapshot.machine.freeDiskGb ?? "?"}G free</span>
                      <span>GPU {(cookbookSnapshot.machine.gpuNames[0] ?? "none").replace(/NVIDIA|AMD|Intel/gi, "").trim() || (cookbookSnapshot.machine.gpuNames[0] ?? "none")}</span>
                      <span>Ollama {runtimeStatus?.ollamaInstalled ? (runtimeStatus?.ollamaRunning ? "up" : "booting") : "provisioning"}</span>
                      <span>Piper {runtimeStatus?.piperInstalled ? "up" : "provisioning"}</span>
                    </div>
                    <small>Models installed: {runtimeStatus?.ollamaModels.join(", ") || "none yet"}</small>
                    <div className="tool-action-row">
                      <button
                        type="button"
                        onClick={() => void handoffCookbookModelsToRouter()}
                        disabled={cookbookRouterHandoffBusy || cookbookModelOptions.length === 0}
                      >
                        {cookbookRouterHandoffBusy ? "Syncing to Router..." : "Send Installed Models To Router"}
                      </button>
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => setSelectedPane({ type: "tool", id: "nexus-router" })}
                      >
                        Open Router
                      </button>
                    </div>
                  </section>

                  <section className="tool-section">
                    <h3>Recommended local models</h3>
                    <ul className="cookbook-recommendation-lines">
                      {cookbookSnapshot.recommendations.map((item) => (
                        <li key={item.id} className="cookbook-recommendation-line">
                          <div className="cookbook-recommendation-main">
                            <span className="cookbook-recommendation-symbol">{recommendationSymbol(item)}</span>
                            <strong>{item.name}</strong>
                            <small>{item.size} · {item.runtime}</small>
                          </div>

                          <div className="tool-action-row cookbook-recommendation-actions">
                            {item.runtime === "ollama" ? (
                              <button
                                type="button"
                                onClick={() => void runRecommendationAction(item)}
                                disabled={runtimeBusyAction !== null || !runtimeStatus?.ollamaInstalled}
                              >
                                {(() => {
                                  const model = recommendationModelName(item);
                                  if (!model) return "Install";
                                  const activePull = findActiveModelPullJob(model);
                                  if (activePull) return activePull.status === "canceling" ? "Canceling..." : "Pause";
                                  if (runtimeStatus?.ollamaModels.includes(model)) return "Installed";
                                  return "Install";
                                })()}
                              </button>
                            ) : (
                              <button type="button" className="ghost" disabled>Managed</button>
                            )}
                            <button type="button" className="ghost" onClick={() => setCookbookTab("jobs")}>Jobs</button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </section>
                </>
              ) : (
                <div className="placeholder-view">
                  <h2>Cookbook</h2>
                  <p>Run a machine scan to generate local model recommendations.</p>
                </div>
              )}
            </div>
          ) : null}

          {selectedPane.type === "tool" && selectedPane.id === "media-center" && mediaCenterTab === "voice" ? (
            <div className="tool-view tool-console">
              <div className="tool-header-row">
                <div>
                  <h2>Media Center</h2>
                  <p className="subtitle">Immediate speech playback in NexusOS, with WanGP Deepy handling synthesis and Whisper handling mic transcription.</p>
                </div>
                <button type="button" onClick={() => void loadVoiceStatus()} disabled={voiceBusy}>
                  {voiceBusy ? "Checking..." : "Refresh Voice Status"}
                </button>
              </div>

              {renderMediaCenterTabs()}

              <section className="tool-section">
                <textarea
                  value={voiceText}
                  onChange={(event) => setVoiceText(event.target.value)}
                  rows={6}
                  placeholder="Type text to speak..."
                />
                <div className="tool-action-row">
                  <button type="button" onClick={playVoicePreview} disabled={!voiceText.trim() || voicePlaying}>
                    {voicePlaying ? "Playing..." : "Play Voice"}
                  </button>
                  <button type="button" onClick={() => void saveVoiceGeneration()} disabled={!voiceText.trim() || voiceSaveBusy}>
                    {voiceSaveBusy ? "Saving..." : "Save To Assets"}
                  </button>
                  <button type="button" className="ghost" onClick={voiceRecording ? stopVoiceRecording : startVoiceRecording} disabled={voiceTranscribing}>
                    {voiceRecording ? "Stop Mic" : voiceTranscribing ? "Transcribing..." : "Record Mic"}
                  </button>
                  <button type="button" className="ghost" onClick={stopVoicePlayback} disabled={!voicePlaying}>
                    Stop
                  </button>
                </div>
              </section>

              {runtimeStatus?.piperInstalled ? (
                <section className="tool-section">
                  <h3>Offline Voice Preview</h3>
                  <label>
                    Voice
                    <select
                      value={voicePreviewVoiceId}
                      onChange={(event) => setVoicePreviewVoiceId(event.target.value)}
                      disabled={voiceAvailableVoices.length === 0}
                    >
                      {voiceAvailableVoices.length === 0 ? <option value="">No voices installed</option> : null}
                      {voiceAvailableVoices.map((voiceId) => <option key={voiceId} value={voiceId}>{voiceId}</option>)}
                    </select>
                  </label>
                  <small>Installed Piper voices: {runtimeStatus?.piperVoices.join(", ") || "none yet"}</small>
                  <small>WanGP is the main speech engine; Piper remains available as a fallback voice path.</small>
                </section>
              ) : null}

              {runtimeStatus?.piperInstalled ? (
                <section className="tool-section">
                  <h3>Harness Voice Assignments</h3>
                  <ul className="tool-list">
                    {(boot?.harnesses ?? []).map((harness) => (
                      <li key={harness.id} className="harness-voice-row">
                        <strong>{harness.name}</strong>
                        <select
                          value={voiceAssignments[harness.id] ?? ""}
                          onChange={(event) => {
                            const next = { ...voiceAssignments, [harness.id]: event.target.value };
                            if (!event.target.value) {
                              delete next[harness.id];
                            }
                            void saveVoiceAssignments(next);
                          }}
                          disabled={voiceAssignmentsBusy || voiceAvailableVoices.length === 0}
                        >
                          <option value="">Default voice</option>
                          {voiceAvailableVoices.map((voiceId) => <option key={voiceId} value={voiceId}>{voiceId}</option>)}
                        </select>
                      </li>
                    ))}
                  </ul>
                  <small>Assignments are saved and can be applied automatically for harness-specific speech output.</small>
                </section>
              ) : null}

              {voiceStatus ? (
                <section className="tool-card-grid">
                  <article className="tool-card">
                    <h3>Browser speech</h3>
                    <p>{voiceStatus.browserSpeechRecommended ? "active fallback" : "available"}</p>
                    <small>Runs immediately in the app UI when Piper is not ready or not preferred.</small>
                  </article>
                  <article className="tool-card">
                    <h3>Piper</h3>
                    <p>{voiceStatus.piperInstalled ? "installed" : "not detected"}</p>
                    <small>{voiceStatus.piperPath ?? "Install Piper for offline voices and exportable audio files."}</small>
                  </article>
                </section>
              ) : null}

              {voiceStatus ? (
                <section className="tool-section">
                  <h3>Notes</h3>
                  <ul className="tool-list">
                    {voiceStatus.notes.map((note) => <li key={note}>{note}</li>)}
                  </ul>
                </section>
              ) : null}
            </div>
          ) : null}

          {selectedPane.type === "tool" && selectedPane.id === "media-center" && mediaCenterTab === "music" ? (
            <div className="tool-view tool-console">
              <div className="tool-header-row">
                <div>
                  <h2>Media Center</h2>
                  <p className="subtitle">Nexus-native Stable Audio generation using local Stable Audio 3 runtime.</p>
                </div>
                <button type="button" onClick={() => void loadStableAudioStatus()} disabled={stableAudioBusyAction !== null}>
                  {stableAudioBusyAction === "refresh" ? "Refreshing..." : "Refresh"}
                </button>
              </div>

              {renderMediaCenterTabs()}

              <section className="tool-section">
                <h3>Generate Audio</h3>
                <div className="stable-audio-form">
                  <label>
                    <span>Mode</span>
                    <select value={stableAudioMode} onChange={(event) => setStableAudioMode(event.target.value as "small-music" | "small-sfx" | "medium")}>
                      {(stableAudioStatus?.modes ?? []).map((mode) => (
                        <option key={mode.id} value={mode.id} disabled={!mode.available}>{mode.label}</option>
                      ))}
                    </select>
                  </label>

                  <label>
                    <span>Duration (seconds)</span>
                    <input
                      type="number"
                      min={1}
                      max={stableAudioMode === "medium" ? 380 : 120}
                      value={stableAudioDuration}
                      onChange={(event) => setStableAudioDuration(Number(event.target.value || 30))}
                    />
                  </label>

                  <label>
                    <span>Prompt</span>
                    <textarea
                      rows={4}
                      value={stableAudioPrompt}
                      onChange={(event) => setStableAudioPrompt(event.target.value)}
                      placeholder="Describe the song or sound effect you want..."
                    />
                  </label>

                  <button
                    type="button"
                    onClick={() => void generateStableAudio()}
                    disabled={stableAudioBusyAction !== null || !stableAudioPrompt.trim()}
                  >
                    {stableAudioBusyAction === "generate" ? "Generating..." : "Generate Song"}
                  </button>
                </div>

                <small>Status: {stableAudioStatus?.installed ? "runtime ready" : "runtime needs install"} · mode max {stableAudioMode === "medium" ? "380s" : "120s"}</small>
                <small>Medium requires a compatible NVIDIA setup. If medium fails, use Small Music or check Cookbook recommendations.</small>
              </section>

              <section className="tool-section">
                <h3>Recent Outputs</h3>
                {stableAudioGenerated.length === 0 ? (
                  <small>No generated clips yet. Your first successful run will be saved into Assets/music.</small>
                ) : (
                  <ul className="tool-list">
                    {stableAudioGenerated.map((clip) => (
                      <li key={`${clip.relativePath}-${clip.mode}`}>
                        {clip.mode} · {clip.duration}s · {clip.relativePath}
                        <audio controls preload="none" src={clip.playbackUrl} />
                      </li>
                    ))}
                  </ul>
                )}
              </section>

            </div>
          ) : null}

          {selectedPane.type === "tool" && selectedPane.id === "media-center" && mediaCenterTab === "image" ? (
            <div className="tool-view tool-console">
              <div className="tool-header-row">
                <div>
                  <h2>Media Center</h2>
                  <p className="subtitle">Wan2GP headless image generation with low-VRAM profile defaults and first-run model downloads.</p>
                </div>
              </div>

              {renderMediaCenterTabs()}

              <section className="tool-section">
                <h3>Generate Image</h3>
                <div className="stable-audio-form">
                  {!wan2GpStatus?.apiReady ? (
                    <small>Wan2GP is not ready yet. Install runtime job: install-wan2gp, then start-wan2gp.</small>
                  ) : null}
                  <div>
                    <span>Size Presets</span>
                    <div className="image-preset-row">
                      {IMAGE_SIZE_PRESETS.map((preset) => (
                        <button key={preset.id} type="button" className="ghost" onClick={() => applyImageSizePreset(preset)} disabled={imageBusyAction !== null}>
                          {preset.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <label>
                    <span>Model</span>
                    <select value={imageModel} onChange={(event) => setImageModel(event.target.value)}>
                      {(wan2GpStatus?.modelHints.image ?? ["auto"]).map((modelName) => (
                        <option key={modelName} value={modelName}>{modelName}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>VRAM Profile</span>
                    <input type="number" min={1} max={5} value={wanProfile} onChange={(event) => setWanProfile(Number(event.target.value || 4))} />
                  </label>
                  <small>Recommended profile: {wan2GpStatus?.recommended.profile ?? 4} (higher is safer for low VRAM).</small>
                  {wan2GpStatus?.notes?.length ? (
                    <small>{wan2GpStatus.notes[wan2GpStatus.notes.length - 1]}</small>
                  ) : null}
                  <div className="image-size-grid">
                    <label>
                      <span>Width</span>
                      <input type="number" min={256} max={1280} step={64} value={imageWidth} onChange={(event) => setImageWidth(Number(event.target.value || 768))} />
                    </label>
                    <label>
                      <span>Height</span>
                      <input type="number" min={256} max={1280} step={64} value={imageHeight} onChange={(event) => setImageHeight(Number(event.target.value || 768))} />
                    </label>
                  </div>
                  <label>
                    <span>Steps</span>
                    <input type="number" min={1} max={60} value={imageSteps} onChange={(event) => setImageSteps(Number(event.target.value || 6))} />
                  </label>
                  <label>
                    <span>Seed (-1 = random)</span>
                    <input type="number" value={imageSeed} onChange={(event) => setImageSeed(Number(event.target.value || -1))} />
                  </label>
                  <label>
                    <span>Prompt</span>
                    <textarea rows={4} value={imagePrompt} onChange={(event) => setImagePrompt(event.target.value)} placeholder="Describe the image you want to generate..." />
                  </label>
                  <label>
                    <span>Negative Prompt</span>
                    <textarea rows={2} value={imageNegativePrompt} onChange={(event) => setImageNegativePrompt(event.target.value)} placeholder="blurry, low quality, artifacts..." />
                  </label>
                  <div className="tool-action-row">
                    <button type="button" onClick={() => void generateImage()} disabled={imageBusyAction !== null || !imagePrompt.trim()}>
                      {imageBusyAction === "generate" ? "Generating..." : "Generate"}
                    </button>
                    <button type="button" className="ghost" onClick={stopImageGeneration} disabled={imageBusyAction !== "generate"}>
                      Stop
                    </button>
                    <button type="button" className="ghost" onClick={() => void saveGeneratedImage()} disabled={imageBusyAction !== null || !imageResult?.imageUrl}>
                      {imageBusyAction === "save" ? "Saving..." : "Save To Workspace"}
                    </button>
                  </div>
                </div>
              </section>

              <section className="tool-section">
                <h3>Preview</h3>
                {imageResult?.imageUrl ? (
                  <div className="image-preview-panel">
                    <img src={imageResult.imageUrl} alt="Generated output preview" />
                    <small>{imageResult.provider} · {imageResult.model} · {imageResult.width}x{imageResult.height} · steps {imageResult.steps ?? "-"} · profile {imageResult.profile ?? "-"} · seed {imageResult.seed ?? "-"}</small>
                    {imageResult.relativePath ? <small>Saved: {imageResult.relativePath}</small> : null}
                  </div>
                ) : (
                  <small>Generate an image to preview it here.</small>
                )}
              </section>

              <section className="tool-section">
                <h3>Status Stream</h3>
                <pre className="image-status-stream">{imageStatusTrace || "No status yet."}</pre>
              </section>

              <section className="tool-section">
                <h3>Recent Images</h3>
                {recentImages.length === 0 ? (
                  <small>No recent generations yet.</small>
                ) : (
                  <ul className="tool-list">
                    {recentImages.map((image) => (
                      <li key={`${image.imageUrl}-${image.createdAt}`}>
                        {image.model} · {image.width}x{image.height} · {new Date(image.createdAt).toLocaleTimeString()}
                        <small>{image.prompt}</small>
                        {image.relativePath ? <small>Saved: {image.relativePath}</small> : null}
                        <div className="tool-action-row">
                          <button type="button" className="ghost" onClick={() => openRecentImage(image)}>
                            Open
                          </button>
                          <button type="button" className="ghost" onClick={() => void saveGeneratedImage(image)} disabled={imageBusyAction !== null}>
                            Re-save
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          ) : null}

          {selectedPane.type === "tool" && selectedPane.id === "media-center" && mediaCenterTab === "video" ? (
            <div className="tool-view tool-console">
              <div className="tool-header-row">
                <div>
                  <h2>Media Center</h2>
                  <p className="subtitle">Wan2GP headless video generation with low-VRAM defaults and live progress streaming.</p>
                </div>
              </div>

              {renderMediaCenterTabs()}

              <section className="tool-section">
                <h3>Generate Video</h3>
                <div className="stable-audio-form">
                  {!wan2GpStatus?.apiReady ? (
                    <small>Wan2GP is not ready yet. Install runtime job: install-wan2gp, then start-wan2gp.</small>
                  ) : null}
                  <label>
                    <span>Model</span>
                    <select value={videoModel} onChange={(event) => setVideoModel(event.target.value)}>
                      {(wan2GpStatus?.modelHints.video ?? ["auto"]).map((modelName) => (
                        <option key={modelName} value={modelName}>{modelName}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>VRAM Profile</span>
                    <input type="number" min={1} max={5} value={wanProfile} onChange={(event) => setWanProfile(Number(event.target.value || 4))} />
                  </label>
                  <div className="image-size-grid">
                    <label>
                      <span>Width</span>
                      <input type="number" min={320} max={1024} step={64} value={videoWidth} onChange={(event) => setVideoWidth(Number(event.target.value || 640))} />
                    </label>
                    <label>
                      <span>Height</span>
                      <input type="number" min={192} max={1024} step={64} value={videoHeight} onChange={(event) => setVideoHeight(Number(event.target.value || 384))} />
                    </label>
                  </div>
                  <div className="image-size-grid">
                    <label>
                      <span>Steps</span>
                      <input type="number" min={1} max={60} value={videoSteps} onChange={(event) => setVideoSteps(Number(event.target.value || 6))} />
                    </label>
                    <label>
                      <span>Duration (s)</span>
                      <input type="number" min={1} max={12} value={videoDurationSeconds} onChange={(event) => setVideoDurationSeconds(Number(event.target.value || 3))} />
                    </label>
                  </div>
                  <div className="image-size-grid">
                    <label>
                      <span>FPS</span>
                      <input type="number" min={8} max={32} value={videoFps} onChange={(event) => setVideoFps(Number(event.target.value || 16))} />
                    </label>
                    <label>
                      <span>Frames</span>
                      <input type="number" min={17} max={193} value={videoFrameCount} onChange={(event) => setVideoFrameCount(Number(event.target.value || 49))} />
                    </label>
                  </div>
                  <label>
                    <span>Seed (-1 = random)</span>
                    <input type="number" value={videoSeed} onChange={(event) => setVideoSeed(Number(event.target.value || -1))} />
                  </label>
                  <label>
                    <span>Prompt</span>
                    <textarea rows={4} value={videoPrompt} onChange={(event) => setVideoPrompt(event.target.value)} placeholder="Describe the video you want to generate..." />
                  </label>
                  <label>
                    <span>Negative Prompt</span>
                    <textarea rows={2} value={videoNegativePrompt} onChange={(event) => setVideoNegativePrompt(event.target.value)} placeholder="blurry, flicker, artifacts..." />
                  </label>
                  <div className="tool-action-row">
                    <button type="button" onClick={() => void generateVideo()} disabled={videoBusyAction !== null || !videoPrompt.trim()}>
                      {videoBusyAction === "generate" ? "Generating..." : "Generate Video"}
                    </button>
                    <button type="button" className="ghost" onClick={stopVideoGeneration} disabled={videoBusyAction !== "generate"}>
                      Stop
                    </button>
                  </div>
                </div>
              </section>

              <section className="tool-section">
                <h3>Preview</h3>
                {videoResult?.videoUrl ? (
                  <div className="image-preview-panel">
                    <video controls preload="metadata" src={videoResult.videoUrl} />
                    <small>{videoResult.provider} · {videoResult.model} · {videoResult.width}x{videoResult.height} · steps {videoResult.steps ?? "-"} · profile {videoResult.profile ?? "-"} · fps {videoResult.fps ?? "-"} · frames {videoResult.frameCount ?? "-"}</small>
                    {videoResult.relativePath ? <small>Saved: {videoResult.relativePath}</small> : null}
                  </div>
                ) : (
                  <small>Generate a video to preview it here.</small>
                )}
              </section>

              <section className="tool-section">
                <h3>Status Stream</h3>
                <pre className="image-status-stream">{videoStatusTrace || "No status yet."}</pre>
              </section>

              <section className="tool-section">
                <h3>Recent Videos</h3>
                {recentVideos.length === 0 ? (
                  <small>No recent generations yet.</small>
                ) : (
                  <ul className="tool-list">
                    {recentVideos.map((video) => (
                      <li key={`${video.videoUrl}-${video.createdAt}`}>
                        {video.model} · {video.width}x{video.height} · {new Date(video.createdAt).toLocaleTimeString()}
                        <small>{video.prompt}</small>
                        {video.relativePath ? <small>Saved: {video.relativePath}</small> : null}
                        <div className="tool-action-row">
                          <button type="button" className="ghost" onClick={() => openRecentVideo(video)}>
                            Open
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          ) : null}

          {selectedPane.type === "tool" && selectedPane.id === "media-center" && mediaCenterTab === "models" ? (
            <div className="tool-view tool-console">
              <div className="tool-header-row">
                <div>
                  <h2>Media Center</h2>
                  <p className="subtitle">Hunyuan3D-2GP local image-to-3D mesh generation tuned for lower VRAM systems.</p>
                </div>
              </div>

              {renderMediaCenterTabs()}

              <section className="tool-section">
                <h3>Generate 3D Mesh</h3>
                <div className="stable-audio-form">
                  {!hunyuan3dStatus?.apiReady ? (
                    <small>Hunyuan3D-2GP is not ready yet. Install runtime job: install-hunyuan3d, then start-hunyuan3d.</small>
                  ) : null}
                  {hunyuan3dStatus?.notes?.length ? (
                    <small>{hunyuan3dStatus.notes[hunyuan3dStatus.notes.length - 1]}</small>
                  ) : null}
                  <div className="tool-action-row">
                    <button
                      type="button"
                      className={model3dInputMode === "image" ? "" : "ghost"}
                      onClick={() => setModel3dInputMode("image")}
                    >
                      Image to 3D
                    </button>
                    <button
                      type="button"
                      className={model3dInputMode === "text" ? "" : "ghost"}
                      onClick={() => setModel3dInputMode("text")}
                    >
                      Text to 3D
                    </button>
                  </div>

                  {model3dInputMode === "image" ? (
                    <>
                      <label>
                        <span>Source Image URL</span>
                        <input
                          type="text"
                          value={model3dSourceImageUrl}
                          onChange={(event) => {
                            setModel3dSourceImageUrl(event.target.value);
                            if (event.target.value.trim()) {
                              setModel3dSourceImageBase64("");
                              setModel3dSourceImageFileName("");
                            }
                          }}
                          placeholder="Use a generated image URL or any reachable PNG/JPG/WEBP URL"
                        />
                      </label>
                      <label>
                        <span>Or Upload Source Image</span>
                        <input type="file" accept="image/png,image/jpeg,image/webp" onChange={onModel3dSourceFileSelected} />
                      </label>
                      {model3dSourceImageFileName ? <small>Uploaded: {model3dSourceImageFileName}</small> : null}
                      <div className="tool-action-row">
                        <button type="button" className="ghost" onClick={useLatestGeneratedImageFor3d}>
                          Use Latest Generated Image
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <label>
                        <span>Text Prompt</span>
                        <textarea
                          rows={3}
                          value={model3dTextPrompt}
                          onChange={(event) => setModel3dTextPrompt(event.target.value)}
                          placeholder="A stylized robot fox with polished chrome armor"
                        />
                      </label>
                      <label>
                        <span>Negative Prompt</span>
                        <textarea
                          rows={2}
                          value={model3dTextNegativePrompt}
                          onChange={(event) => setModel3dTextNegativePrompt(event.target.value)}
                          placeholder="blurry, low quality, watermark, text"
                        />
                      </label>
                      <div className="image-size-grid">
                        <label>
                          <span>Text-to-Image Model</span>
                          <input type="text" value={model3dTextImageModel} onChange={(event) => setModel3dTextImageModel(event.target.value)} placeholder="auto" />
                        </label>
                        <label>
                          <span>Text-to-Image Steps</span>
                          <input type="number" min={4} max={40} value={model3dTextImageSteps} onChange={(event) => setModel3dTextImageSteps(Number(event.target.value || 6))} />
                        </label>
                      </div>
                      <div className="image-size-grid">
                        <label>
                          <span>Text-to-Image Size</span>
                          <input type="number" min={256} max={1024} step={64} value={model3dTextImageWidth} onChange={(event) => setModel3dTextImageWidth(Number(event.target.value || 768))} />
                        </label>
                        <label>
                          <span>Text-to-Image Size (H)</span>
                          <input type="number" min={256} max={1024} step={64} value={model3dTextImageHeight} onChange={(event) => setModel3dTextImageHeight(Number(event.target.value || 768))} />
                        </label>
                      </div>
                      <div className="image-size-grid">
                        <label>
                          <span>Text-to-Image Profile</span>
                          <input type="number" min={1} max={6} value={model3dTextImageProfile} onChange={(event) => setModel3dTextImageProfile(Number(event.target.value || 4))} />
                        </label>
                        <label>
                          <span>Text-to-Image Seed (-1 = random)</span>
                          <input type="number" value={model3dTextImageSeed} onChange={(event) => setModel3dTextImageSeed(Number(event.target.value || -1))} />
                        </label>
                      </div>
                    </>
                  )}

                  {model3dInputMode === "image" && model3dSourcePreviewUrl ? (
                    <div className="model3d-source-preview">
                      <small>Source Thumbnail</small>
                      <img src={model3dSourcePreviewUrl} alt="3D source thumbnail" />
                    </div>
                  ) : null}
                  <label>
                    <span>Model Path</span>
                    <input type="text" value={model3dModelPath} onChange={(event) => setModel3dModelPath(event.target.value)} />
                  </label>
                  <label>
                    <span>Subfolder</span>
                    <input type="text" value={model3dSubfolder} onChange={(event) => setModel3dSubfolder(event.target.value)} />
                  </label>
                  <div className="image-size-grid">
                    <label>
                      <span>Inference Steps</span>
                      <input type="number" min={5} max={60} value={model3dNumInferenceSteps} onChange={(event) => setModel3dNumInferenceSteps(Number(event.target.value || 20))} />
                    </label>
                    <label>
                      <span>Octree Resolution</span>
                      <input type="number" min={128} max={512} step={32} value={model3dOctreeResolution} onChange={(event) => setModel3dOctreeResolution(Number(event.target.value || 192))} />
                    </label>
                  </div>
                  <div className="image-size-grid">
                    <label>
                      <span>Guidance Scale</span>
                      <input type="number" min={1} max={10} step={0.1} value={model3dGuidanceScale} onChange={(event) => setModel3dGuidanceScale(Number(event.target.value || 5))} />
                    </label>
                    <label>
                      <span>Output Format</span>
                      <select value={model3dFormat} onChange={(event) => setModel3dFormat(event.target.value === "obj" ? "obj" : "glb")}>
                        <option value="glb">glb</option>
                        <option value="obj">obj</option>
                      </select>
                    </label>
                  </div>
                  <label>
                    <span>Seed (-1 = random)</span>
                    <input type="number" value={model3dSeed} onChange={(event) => setModel3dSeed(Number(event.target.value || -1))} />
                  </label>
                  <div className="tool-action-row">
                    <button
                      type="button"
                      onClick={() => void generateModel3d()}
                      disabled={model3dBusyAction !== null || (model3dInputMode === "image" ? (!model3dSourceImageUrl.trim() && !model3dSourceImageBase64.trim()) : !model3dTextPrompt.trim())}
                    >
                      {model3dBusyAction === "generate" ? "Generating..." : "Generate 3D Mesh"}
                    </button>
                    <button type="button" className="ghost" onClick={stopModel3dGeneration} disabled={model3dBusyAction !== "generate"}>
                      Stop
                    </button>
                  </div>
                </div>
              </section>

              <section className="tool-section">
                <h3>Preview</h3>
                {model3dResult?.modelUrl ? (
                  <div className="image-preview-panel">
                    <small>{model3dResult.provider} · {model3dResult.modelPath}/{model3dResult.subfolder} · {model3dResult.format.toUpperCase()} · device {model3dResult.device} · source {model3dResult.sourceKind}</small>
                    {model3dResult.sourceImageUrl ? (
                      <div className="model3d-source-preview">
                        <small>Source Thumbnail</small>
                        <img src={model3dResult.sourceImageUrl} alt="Generated mesh source" />
                      </div>
                    ) : null}
                    <Model3dViewport modelUrl={model3dResult.modelUrl} format={model3dResult.format} />
                    {model3dResult.relativePath ? <small>Saved: {model3dResult.relativePath}</small> : null}
                    <div className="tool-action-row">
                      <a href={model3dResult.modelUrl} target="_blank" rel="noreferrer">
                        Download / Open Mesh File
                      </a>
                    </div>
                  </div>
                ) : (
                  <small>Generate a mesh to get the model file link here.</small>
                )}
              </section>

              <section className="tool-section">
                <h3>Status Stream</h3>
                <pre className="image-status-stream">{model3dStatusTrace || "No status yet."}</pre>
              </section>

              <section className="tool-section">
                <h3>Recent 3D Models</h3>
                {recentModels3d.length === 0 ? (
                  <small>No recent 3D generations yet.</small>
                ) : (
                  <ul className="tool-list">
                    {recentModels3d.map((model) => (
                      <li key={`${model.modelUrl}-${model.createdAt}`}>
                        {model.modelPath} · {model.format.toUpperCase()} · seed {model.seed} · source {model.sourceKind} · {new Date(model.createdAt).toLocaleTimeString()}
                        {model.sourceImageUrl ? <img className="model3d-recent-thumb" src={model.sourceImageUrl} alt="Recent source thumbnail" /> : null}
                        {model.relativePath ? <small>Saved: {model.relativePath}</small> : null}
                        <div className="tool-action-row">
                          <button type="button" className="ghost" onClick={() => openRecentModel3d(model)}>
                            Open
                          </button>
                          <a href={model.modelUrl} target="_blank" rel="noreferrer">
                            Download
                          </a>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          ) : null}

          {selectedPane.type === "tool" && selectedPane.id === "settings" ? (
            <div className="tool-view tool-console">
              <div className="tool-header-row">
                <div>
                  <h2>Settings</h2>
                  <p className="subtitle">Connect services, tune appearance, and control repository automation.</p>
                </div>
              </div>

              <div className="settings-tabs" role="tablist" aria-label="Settings sections">
                <button
                  type="button"
                  className={`tool-tab ${settingsTab === "connectors" ? "active" : ""}`}
                  onClick={() => setSettingsTab("connectors")}
                >
                  Connectors
                </button>
                <button
                  type="button"
                  className={`tool-tab ${settingsTab === "appearance" ? "active" : ""}`}
                  onClick={() => setSettingsTab("appearance")}
                >
                  Appearance
                </button>
                <button
                  type="button"
                  className={`tool-tab ${settingsTab === "automation" ? "active" : ""}`}
                  onClick={() => setSettingsTab("automation")}
                >
                  Automation
                </button>
              </div>

              {settingsTab === "connectors" ? (
                <>
                  <section className="tool-section">
                    <div className="connector-placeholder-grid">
                      {connectorCards.map((connector) => (
                        <button
                          key={connector.id}
                          type="button"
                          className="connector-placeholder-card connector-card-button"
                          onClick={() => setActiveConnectorId(connector.id)}
                        >
                          <strong>{connector.name}</strong>
                          <small>{connector.connected ? "connected" : "not connected"}</small>
                        </button>
                      ))}
                    </div>
                  </section>

                  {activeConnectorId ? (
                    <div className="connector-modal-backdrop" onClick={() => setActiveConnectorId(null)}>
                      <div className="connector-modal" onClick={(event) => event.stopPropagation()}>
                        <div className="tool-header-row">
                          <h3>{connectorCards.find((connector) => connector.id === activeConnectorId)?.name ?? "Connector"}</h3>
                          <button type="button" className="ghost" onClick={() => setActiveConnectorId(null)}>Close</button>
                        </div>

                        {activeConnectorId === "github" ? (
                          <>
                            {githubInlineError ? <p className="connector-inline-error">{githubInlineError}</p> : null}
                            {githubConnector?.connected ? (
                              <small>Connected as {githubConnector.login ?? "unknown"} ({githubConnector.maskedToken ?? "token"})</small>
                            ) : (
                              <small>Start GitHub device flow to connect without pasting a token.</small>
                            )}
                            <label>
                              GitHub OAuth Client ID
                              <input
                                type="text"
                                value={githubClientId}
                                placeholder="GitHub OAuth app client ID"
                                onChange={(event) => setGithubClientId(event.target.value)}
                              />
                            </label>
                            <div className="tool-action-row">
                              <button type="button" onClick={() => void startGitHubDeviceFlow()} disabled={githubBusy !== null}>
                                {githubBusy === "device-start" || githubBusy === "device-poll" ? "Connecting..." : "Connect GitHub"}
                              </button>
                              <button type="button" className="ghost" onClick={() => void disconnectGitHubConnector()} disabled={githubBusy !== null || !githubConnector?.connected}>
                                {githubBusy === "disconnect" ? "Disconnecting..." : "Disconnect"}
                              </button>
                            </div>
                            {githubDeviceFlow ? (
                              <div className="github-device-card">
                                <strong>Device Code: {githubDeviceFlow.userCode}</strong>
                                <small>Go to {githubDeviceFlow.verificationUri} and enter the code above.</small>
                                <small>Scopes: {githubDeviceFlow.scopes.join(", ")}</small>
                                <small>Expires: {new Date(githubDeviceFlow.expiresAt).toLocaleTimeString()}</small>
                              </div>
                            ) : null}
                            <details className="github-advanced-details">
                              <summary>Advanced token fallback</summary>
                              <label>
                                GitHub Token
                                <input
                                  type="password"
                                  value={githubTokenDraft}
                                  placeholder="github_pat_..."
                                  onChange={(event) => setGithubTokenDraft(event.target.value)}
                                />
                              </label>
                              <div className="tool-action-row">
                                <button type="button" onClick={() => void connectGitHubConnector()} disabled={githubBusy !== null || !githubTokenDraft.trim()}>
                                  {githubBusy === "connect" ? "Connecting..." : "Use Token Instead"}
                                </button>
                              </div>
                            </details>
                          </>
                        ) : activeConnectorId === "gmail" ? (
                          <>
                            <small>Gmail will use a browser-based connect flow when implemented.</small>
                            <div className="tool-action-row">
                              <button type="button" onClick={() => pushToast("Gmail connector coming soon.", "warn")}>Connect Gmail</button>
                            </div>
                          </>
                        ) : (
                          <>
                            <small>This connector is reserved and not wired yet.</small>
                            <div className="tool-action-row">
                              <button type="button" onClick={() => pushToast(`${connectorCards.find((connector) => connector.id === activeConnectorId)?.name ?? "Connector"} is coming soon.`, "warn")}>Okay</button>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  ) : null}
                </>
              ) : null}

              {settingsTab === "appearance" ? (
                <section className="tool-section">
                  <h3>Theme Colors</h3>
                  <div className="theme-grid" role="radiogroup" aria-label="Theme presets">
                    {THEME_PRESETS.map((theme) => (
                      <button
                        key={theme.id}
                        type="button"
                        className={`theme-card ${themeId === theme.id ? "active" : ""}`}
                        onClick={() => setThemeId(theme.id)}
                      >
                        <strong>{theme.name}</strong>
                        <small>{theme.hint}</small>
                      </button>
                    ))}
                  </div>
                </section>
              ) : null}

              {settingsTab === "automation" ? (
                <section className="tool-section">
                  <div className="tool-header-row">
                    <h3>Git Workspace</h3>
                    <button type="button" className="ghost" onClick={() => void loadGitStatus()} disabled={gitBusyAction !== null}>
                      {gitBusyAction === "refresh" ? "Refreshing..." : "Refresh"}
                    </button>
                  </div>

                  {gitStatus ? (
                    <div className="git-status-grid">
                      <span>branch: {gitStatus.branch}</span>
                      <span>ahead: {gitStatus.ahead}</span>
                      <span>behind: {gitStatus.behind}</span>
                      <span>staged: {gitStatus.counts.staged}</span>
                      <span>unstaged: {gitStatus.counts.unstaged}</span>
                      <span>untracked: {gitStatus.counts.untracked}</span>
                    </div>
                  ) : (
                    <small>Git status not loaded yet.</small>
                  )}

                  <label>
                    Commit Message
                    <input
                      type="text"
                      value={gitCommitMessage}
                      onChange={(event) => setGitCommitMessage(event.target.value)}
                      placeholder="Describe this change"
                    />
                  </label>

                  <div className="tool-action-row">
                    <button type="button" onClick={() => void runGitCommit()} disabled={gitBusyAction !== null}>
                      {gitBusyAction === "commit" ? "Committing..." : "Commit All Changes"}
                    </button>
                    <button type="button" className="ghost" onClick={() => void runGitPush()} disabled={gitBusyAction !== null}>
                      {gitBusyAction === "push" ? "Pushing..." : "Push Branch"}
                    </button>
                  </div>

                  {gitStatus?.entries.length ? (
                    <details className="git-entry-list">
                      <summary>Changed files ({gitStatus.entries.length})</summary>
                      <ul>
                        {gitStatus.entries.slice(0, 40).map((entry) => (
                          <li key={`${entry.x}${entry.y}-${entry.path}`}>
                            <span>{entry.x}{entry.y}</span>
                            <span>{entry.path}</span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                </section>
              ) : null}
            </div>
          ) : null}

          {selectedPane.type === "tool" && !["nexus-router", "cookbook", "voice-studio", "music-generator", "image-generator", "media-center", "settings"].includes(selectedPane.id) ? (
            <div className="placeholder-view">
              <h2>{boot?.tools.find((tool) => tool.id === selectedPane.id)?.name ?? "Tool"}</h2>
              <p>Tool plugin slot ready. Hook this panel to a future backend module.</p>
            </div>
          ) : null}

          {selectedPane.type === "agent" ? (
            <div className="chat-view">
              <div className="chat-layout">
                <aside className="chat-thread-pane">
                  <div className="chat-thread-header">
                    <h3>{activeHarness?.name ?? "Harness"}</h3>
                    <small>Workspace: {boot?.activeWorkspaceId ?? "default"}</small>
                  </div>
                  <div className="harness-tabs">
                    {(["chats", "scheduled", "runs"] as HarnessSubTab[]).map((tab) => (
                      <button
                        key={tab}
                        type="button"
                        className={`harness-tab ${activeHarnessSubTab === tab ? "active" : ""}`}
                        onClick={() => {
                          if (!activeHarness) {
                            return;
                          }
                          setHarnessSubTabByHarness((current) => ({ ...current, [activeHarness.id]: tab }));
                          if (tab === "scheduled") {
                            void loadHarnessSchedules(activeHarness.id);
                          }
                          if (tab === "runs") {
                            void loadHarnessRuns(activeHarness.id);
                          }
                        }}
                      >
                        {tab === "chats" ? "Chats" : tab === "scheduled" ? "Scheduled" : "Runs"}
                      </button>
                    ))}
                  </div>

                  {activeHarnessSubTab === "chats" ? (
                    <>
                      <button
                        type="button"
                        className="ghost thread-create"
                        onClick={() => {
                          if (!activeHarness) return;
                          const thread = createThread();
                          setChatThreadsByHarness((current) => ({
                            ...current,
                            [activeHarness.id]: [thread, ...(current[activeHarness.id] ?? [])],
                          }));
                          setActiveThreadByHarness((current) => ({ ...current, [activeHarness.id]: thread.id }));
                          void saveHarnessThread(activeHarness.id, thread);
                          setComposer("");
                        }}
                      >
                        New Chat
                      </button>
                      <ul className="chat-thread-list">
                        {harnessThreads.map((thread) => (
                          <li key={thread.id}>
                            <button
                              type="button"
                              className={`chat-thread-item ${activeHarnessThreadId === thread.id ? "active" : ""}`}
                              onClick={() => {
                                if (!activeHarness) return;
                                setActiveThreadByHarness((current) => ({ ...current, [activeHarness.id]: thread.id }));
                              }}
                            >
                              <strong>{thread.title || "New chat"}</strong>
                              <small>{new Date(thread.updatedAt).toLocaleString()}</small>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : null}

                  {activeHarnessSubTab === "scheduled" ? (
                    <div className="automation-panel">
                      <label>
                        Title
                        <input
                          type="text"
                          value={activeHarnessDraft.title}
                          onChange={(event) => {
                            if (!activeHarness) return;
                            setScheduleDraftByHarness((current) => ({
                              ...current,
                              [activeHarness.id]: {
                                ...getScheduleDraft(activeHarness.id),
                                title: event.target.value,
                              },
                            }));
                          }}
                          placeholder="Daily summary"
                        />
                      </label>
                      <label>
                        Prompt
                        <textarea
                          rows={4}
                          value={activeHarnessDraft.prompt}
                          onChange={(event) => {
                            if (!activeHarness) return;
                            setScheduleDraftByHarness((current) => ({
                              ...current,
                              [activeHarness.id]: {
                                ...getScheduleDraft(activeHarness.id),
                                prompt: event.target.value,
                              },
                            }));
                          }}
                          placeholder="Run this job..."
                        />
                      </label>
                      <label>
                        Every (minutes)
                        <input
                          type="number"
                          min={1}
                          max={1440}
                          value={activeHarnessDraft.intervalMinutes}
                          onChange={(event) => {
                            if (!activeHarness) return;
                            const next = Number(event.target.value) || 30;
                            setScheduleDraftByHarness((current) => ({
                              ...current,
                              [activeHarness.id]: {
                                ...getScheduleDraft(activeHarness.id),
                                intervalMinutes: Math.max(1, Math.min(1440, next)),
                              },
                            }));
                          }}
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => activeHarness && void onCreateSchedule(activeHarness.id)}
                        disabled={!activeHarness || scheduleBusyHarnessId === activeHarness.id}
                      >
                        {scheduleBusyHarnessId === activeHarness?.id
                          ? "Saving..."
                          : getEditingScheduleId(activeHarness?.id ?? "")
                            ? "Update Schedule"
                            : "Save Schedule"}
                      </button>
                      {activeHarness && getEditingScheduleId(activeHarness.id) ? (
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => {
                            setEditingScheduleIdByHarness((current) => ({ ...current, [activeHarness.id]: null }));
                            setScheduleDraftByHarness((current) => ({
                              ...current,
                              [activeHarness.id]: { title: "", prompt: "", intervalMinutes: 30 },
                            }));
                          }}
                        >
                          Cancel Edit
                        </button>
                      ) : null}

                      <ul className="automation-list">
                        {activeHarnessSchedules.map((schedule) => (
                          <li key={schedule.id}>
                            <strong>{schedule.title}</strong>
                            <small>next: {new Date(schedule.nextRunAt).toLocaleString()}</small>
                            <p>{schedule.prompt}</p>
                            <div className="automation-actions">
                              <span>{schedule.enabled ? "enabled" : "paused"} · every {schedule.intervalMinutes}m</span>
                              <button
                                type="button"
                                className="ghost"
                                onClick={() => {
                                  if (!activeHarness) {
                                    return;
                                  }
                                  setEditingScheduleIdByHarness((current) => ({ ...current, [activeHarness.id]: schedule.id }));
                                  setScheduleDraftByHarness((current) => ({
                                    ...current,
                                    [activeHarness.id]: {
                                      title: schedule.title,
                                      prompt: schedule.prompt,
                                      intervalMinutes: schedule.intervalMinutes,
                                    },
                                  }));
                                }}
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                className="ghost"
                                onClick={() => activeHarness && void onToggleSchedule(activeHarness.id, schedule.id, !schedule.enabled)}
                              >
                                {schedule.enabled ? "Pause" : "Resume"}
                              </button>
                              <button
                                type="button"
                                className="ghost"
                                onClick={() => activeHarness && void onDeleteSchedule(activeHarness.id, schedule.id)}
                              >
                                Delete
                              </button>
                            </div>
                          </li>
                        ))}
                        {activeHarnessSchedules.length === 0 ? <li><small>No schedules yet.</small></li> : null}
                      </ul>
                    </div>
                  ) : null}

                  {activeHarnessSubTab === "runs" ? (
                    <div className="automation-panel">
                      <button
                        type="button"
                        onClick={() => activeHarness && void onManualRun(activeHarness.id)}
                        disabled={!activeHarness || manualRunBusyHarnessId === activeHarness.id}
                      >
                        {manualRunBusyHarnessId === activeHarness?.id ? "Running..." : "Run Now (uses Prompt)"}
                      </button>
                      <small>Manual run uses the prompt from the Scheduled tab draft.</small>

                      <ul className="automation-list">
                        {activeHarnessRuns.map((run) => (
                          <li key={run.id}>
                            <strong>{run.trigger} · {run.status}</strong>
                            <small>{new Date(run.createdAt).toLocaleString()}</small>
                            <p>{run.prompt}</p>
                            {run.output ? <details><summary>Output</summary><p>{run.output}</p></details> : null}
                            {run.error ? <p className="run-error">{run.error}</p> : null}
                          </li>
                        ))}
                        {activeHarnessRuns.length === 0 ? <li><small>No runs yet.</small></li> : null}
                      </ul>
                    </div>
                  ) : null}
                </aside>

                <div className="chat-main">
                  {activeHarnessSubTab !== "chats" ? (
                    <section className="chat-log" aria-live="polite">
                      <article className="message assistant">
                        <p>
                          {activeHarnessSubTab === "scheduled"
                            ? "Manage repeating jobs for this harness in the current workspace."
                            : "Inspect run history and execute manual runs."}
                        </p>
                      </article>
                    </section>
                  ) : (
                    <>
                  <header className="chat-status">
                    <div>
                      <strong>{activeHarness?.name ?? "Harness"}</strong>
                    </div>
                    <div className="status-chip-row">
                      <span className="chip">{chatBusy ? "thinking..." : "ready"}</span>
                      <span className="chip">fallback: {chatMeta?.fallbackUsed ? "yes" : "no"}</span>
                      <span className="chip">voice: {autoSpeakHarnessReplies ? "on" : "off"}</span>
                    </div>
                  </header>

                  <details className="stream-trace" open={streamTraceOpen} onToggle={(event) => setStreamTraceOpen((event.target as HTMLDetailsElement).open)}>
                    <summary>{chatBusy ? "Live stream" : "Last stream"}</summary>
                    <pre>{streamTrace || (chatBusy ? "Waiting for first token..." : "No recent stream content.")}</pre>
                  </details>

                  <section className="chat-log" aria-live="polite">
                    {messages.length === 0 ? (
                      <article className="message assistant">
                        <p>Send a prompt to start your unified harness session.</p>
                      </article>
                    ) : null}

                    {messages.map((message) => (
                      <article key={message.id} className={`message ${message.role}`}>
                        <header>{message.role}</header>
                        {message.role === "assistant" && chatBusy && !message.content ? (
                          <p className="typing-indicator">
                            <span className="typing-dot" />
                            <span className="typing-dot" />
                            <span className="typing-dot" />
                          </p>
                        ) : (
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
                        )}
                        {message.role === "assistant" && message.id === lastAssistantMessageId && chatMeta ? (
                          <small className="message-meta">
                            {chatMeta.provider} | {chatMeta.model} | {chatMeta.elapsedMs} ms | tokens {(chatMeta.tokenUsage.input ?? 0) + (chatMeta.tokenUsage.output ?? 0)}
                          </small>
                        ) : null}
                        {message.role === "user" ? (
                          <div className="message-actions">
                            <button
                              type="button"
                              className="ghost icon-btn"
                              onClick={() => void onSendMessage(message.content)}
                              disabled={chatBusy}
                              title="Retry this prompt"
                              aria-label="Retry this prompt"
                            >
                              <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                                <path d="M12 5a7 7 0 1 1-6.95 7.88h2.04A5 5 0 1 0 12 7h-2.2l2.7 2.7-1.4 1.4L6 6l5.1-5.1 1.4 1.4L9.8 5H12z" fill="currentColor" />
                              </svg>
                            </button>
                            <button
                              type="button"
                              className="ghost icon-btn"
                              onClick={() => void onCopyMessage(message.content)}
                              title="Copy message"
                              aria-label="Copy message"
                            >
                              <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                                <path d="M16 1H6a2 2 0 0 0-2 2v12h2V3h10V1zm3 4H10a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm0 16h-9V7h9v14z" fill="currentColor" />
                              </svg>
                            </button>
                          </div>
                        ) : null}
                        {message.role === "assistant" ? (
                          <div className="message-actions">
                            <button
                              type="button"
                              className="ghost icon-btn"
                              onClick={stopHarnessSpeech}
                              title="Stop voice playback"
                              aria-label="Stop voice playback"
                              disabled={!harnessSpeaking}
                            >
                              <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                                <path d="M5 9v6h4l5 5V4L9 9H5zm12.5 3a4.5 4.5 0 0 0-2.2-3.85v7.7A4.5 4.5 0 0 0 17.5 12z" fill="currentColor" />
                              </svg>
                            </button>
                          </div>
                        ) : null}
                      </article>
                    ))}
                  </section>

                  <footer className="chat-composer">
                    {selectedPane.type === "agent" ? (
                      <div className="harness-extras-wrap">
                        {activeHarnessExtrasOpen ? (
                          <div className="harness-extras-popover drop-up">
                              <strong>Extra Settings · {activeHarness?.name ?? selectedPane.id}</strong>
                              <small>Per-harness opt-in controls for Crawl4AI and OfficeCLI.</small>

                              {["free-claude-code", "free-code", "opencode"].includes(selectedPane.id) ? (
                                <>
                                  <label className="extras-toggle">
                                    <input
                                      type="checkbox"
                                      checked={activeHarnessCapabilities.fableMode.enabled}
                                      onChange={(event) => setHarnessCapabilitiesByHarness((current) => ({
                                        ...current,
                                        [selectedPane.id]: {
                                          ...(current[selectedPane.id] ?? defaultHarnessCapabilities()),
                                          fableMode: {
                                            ...(current[selectedPane.id]?.fableMode ?? defaultHarnessCapabilities().fableMode),
                                            enabled: event.target.checked,
                                            profile: event.target.checked
                                              ? (current[selectedPane.id]?.fableMode?.profile ?? "balanced")
                                              : "off",
                                          },
                                        },
                                      }))}
                                    />
                                    <span>Fable Mode (staged plan/verify/self-critique)</span>
                                  </label>
                                  <label>
                                    Fable Profile
                                    <select
                                      value={activeHarnessCapabilities.fableMode.profile}
                                      onChange={(event) => {
                                        const profile = event.target.value as "off" | "balanced" | "strict";
                                        setHarnessCapabilitiesByHarness((current) => ({
                                          ...current,
                                          [selectedPane.id]: {
                                            ...(current[selectedPane.id] ?? defaultHarnessCapabilities()),
                                            fableMode: {
                                              ...(current[selectedPane.id]?.fableMode ?? defaultHarnessCapabilities().fableMode),
                                              profile,
                                              enabled: profile !== "off",
                                            },
                                          },
                                        }));
                                      }}
                                    >
                                      <option value="off">Off</option>
                                      <option value="balanced">Balanced</option>
                                      <option value="strict">Strict</option>
                                    </select>
                                  </label>
                                  <label className="extras-toggle">
                                    <input
                                      type="checkbox"
                                      checked={activeHarnessCapabilities.openDesign.enabled}
                                      onChange={(event) => setHarnessCapabilitiesByHarness((current) => ({
                                        ...current,
                                        [selectedPane.id]: {
                                          ...(current[selectedPane.id] ?? defaultHarnessCapabilities()),
                                          openDesign: {
                                            ...(current[selectedPane.id]?.openDesign ?? defaultHarnessCapabilities().openDesign),
                                            enabled: event.target.checked,
                                          },
                                        },
                                      }))}
                                    />
                                    <span>Open Design workflow</span>
                                  </label>
                                </>
                              ) : null}

                              <label className="extras-toggle">
                                <input
                                  type="checkbox"
                                  checked={activeHarnessCapabilities.crawl4ai.enabled}
                                  onChange={(event) => setHarnessCapabilitiesByHarness((current) => ({
                                    ...current,
                                    [selectedPane.id]: {
                                      ...(current[selectedPane.id] ?? defaultHarnessCapabilities()),
                                      crawl4ai: {
                                        ...(current[selectedPane.id]?.crawl4ai ?? defaultHarnessCapabilities().crawl4ai),
                                        enabled: event.target.checked,
                                      },
                                    },
                                  }))}
                                />
                                <span>Crawl4AI Enabled</span>
                              </label>
                              <label>
                                Allowed Domains (csv)
                                <input
                                  type="text"
                                  value={activeHarnessCapabilities.crawl4ai.allowedDomains.join(", ")}
                                  onChange={(event) => {
                                    const domains = parseCommaList(event.target.value).map((entry) => entry.toLowerCase());
                                    setHarnessCapabilitiesByHarness((current) => ({
                                      ...current,
                                      [selectedPane.id]: {
                                        ...(current[selectedPane.id] ?? defaultHarnessCapabilities()),
                                        crawl4ai: {
                                          ...(current[selectedPane.id]?.crawl4ai ?? defaultHarnessCapabilities().crawl4ai),
                                          allowedDomains: domains,
                                        },
                                      },
                                    }));
                                  }}
                                  placeholder="example.com, docs.example.com"
                                />
                              </label>
                              <div className="extras-inline-grid">
                                <label className="extras-toggle">
                                  <input
                                    type="checkbox"
                                    checked={activeHarnessCapabilities.crawl4ai.allowExternalDomains}
                                    onChange={(event) => setHarnessCapabilitiesByHarness((current) => ({
                                      ...current,
                                      [selectedPane.id]: {
                                        ...(current[selectedPane.id] ?? defaultHarnessCapabilities()),
                                        crawl4ai: {
                                          ...(current[selectedPane.id]?.crawl4ai ?? defaultHarnessCapabilities().crawl4ai),
                                          allowExternalDomains: event.target.checked,
                                        },
                                      },
                                    }))}
                                  />
                                  <span>Allow External Domains</span>
                                </label>
                                <label className="extras-toggle">
                                  <input
                                    type="checkbox"
                                    checked={activeHarnessCapabilities.crawl4ai.obeyRobotsTxt}
                                    onChange={(event) => setHarnessCapabilitiesByHarness((current) => ({
                                      ...current,
                                      [selectedPane.id]: {
                                        ...(current[selectedPane.id] ?? defaultHarnessCapabilities()),
                                        crawl4ai: {
                                          ...(current[selectedPane.id]?.crawl4ai ?? defaultHarnessCapabilities().crawl4ai),
                                          obeyRobotsTxt: event.target.checked,
                                        },
                                      },
                                    }))}
                                  />
                                  <span>Obey robots.txt</span>
                                </label>
                              </div>
                              <div className="extras-inline-grid">
                                <label>
                                  Max Pages
                                  <input
                                    type="number"
                                    min={1}
                                    max={200}
                                    value={activeHarnessCapabilities.crawl4ai.maxPages}
                                    onChange={(event) => {
                                      const next = Number(event.target.value) || 1;
                                      setHarnessCapabilitiesByHarness((current) => ({
                                        ...current,
                                        [selectedPane.id]: {
                                          ...(current[selectedPane.id] ?? defaultHarnessCapabilities()),
                                          crawl4ai: {
                                            ...(current[selectedPane.id]?.crawl4ai ?? defaultHarnessCapabilities().crawl4ai),
                                            maxPages: Math.max(1, Math.min(200, next)),
                                          },
                                        },
                                      }));
                                    }}
                                  />
                                </label>
                                <label>
                                  Timeout (ms)
                                  <input
                                    type="number"
                                    min={1000}
                                    max={180000}
                                    step={1000}
                                    value={activeHarnessCapabilities.crawl4ai.timeoutMs}
                                    onChange={(event) => {
                                      const next = Number(event.target.value) || 1000;
                                      setHarnessCapabilitiesByHarness((current) => ({
                                        ...current,
                                        [selectedPane.id]: {
                                          ...(current[selectedPane.id] ?? defaultHarnessCapabilities()),
                                          crawl4ai: {
                                            ...(current[selectedPane.id]?.crawl4ai ?? defaultHarnessCapabilities().crawl4ai),
                                            timeoutMs: Math.max(1000, Math.min(180000, next)),
                                          },
                                        },
                                      }));
                                    }}
                                  />
                                </label>
                              </div>

                              <label className="extras-toggle">
                                <input
                                  type="checkbox"
                                  checked={activeHarnessCapabilities.officeCli.enabled}
                                  onChange={(event) => setHarnessCapabilitiesByHarness((current) => ({
                                    ...current,
                                    [selectedPane.id]: {
                                      ...(current[selectedPane.id] ?? defaultHarnessCapabilities()),
                                      officeCli: {
                                        ...(current[selectedPane.id]?.officeCli ?? defaultHarnessCapabilities().officeCli),
                                        enabled: event.target.checked,
                                      },
                                    },
                                  }))}
                                />
                                <span>OfficeCLI Enabled</span>
                              </label>
                              <label>
                                Office Allowed Extensions (csv)
                                <input
                                  type="text"
                                  value={activeHarnessCapabilities.officeCli.allowedExtensions.join(", ")}
                                  onChange={(event) => {
                                    const ext = parseCommaList(event.target.value)
                                      .map((entry) => entry.toLowerCase())
                                      .map((entry) => entry.startsWith(".") ? entry : `.${entry}`);
                                    setHarnessCapabilitiesByHarness((current) => ({
                                      ...current,
                                      [selectedPane.id]: {
                                        ...(current[selectedPane.id] ?? defaultHarnessCapabilities()),
                                        officeCli: {
                                          ...(current[selectedPane.id]?.officeCli ?? defaultHarnessCapabilities().officeCli),
                                          allowedExtensions: ext,
                                        },
                                      },
                                    }));
                                  }}
                                  placeholder=".docx, .xlsx, .pptx"
                                />
                              </label>
                              <label>
                                Office Max File Size (MB)
                                <input
                                  type="number"
                                  min={1}
                                  max={512}
                                  value={activeHarnessCapabilities.officeCli.maxFileSizeMb}
                                  onChange={(event) => {
                                    const next = Number(event.target.value) || 1;
                                    setHarnessCapabilitiesByHarness((current) => ({
                                      ...current,
                                      [selectedPane.id]: {
                                        ...(current[selectedPane.id] ?? defaultHarnessCapabilities()),
                                        officeCli: {
                                          ...(current[selectedPane.id]?.officeCli ?? defaultHarnessCapabilities().officeCli),
                                          maxFileSizeMb: Math.max(1, Math.min(512, next)),
                                        },
                                      },
                                    }));
                                  }}
                                />
                              </label>

                              {activeHarnessCapabilities.officeCli.enabled ? (
                                <div className="extras-inline-grid">
                                  <label>
                                    Office Preset
                                    <select
                                      value={officePresetDraft.preset}
                                      onChange={(event) => setOfficePresetDraft((current) => ({
                                        ...current,
                                        harnessId: selectedPane.id,
                                        preset: event.target.value as "view" | "validate" | "create",
                                      }))}
                                    >
                                      {officePresets.map((preset) => (
                                        <option key={preset.id} value={preset.id}>{preset.label}</option>
                                      ))}
                                    </select>
                                  </label>
                                  <label>
                                    File Path
                                    <input
                                      type="text"
                                      value={officePresetDraft.harnessId === selectedPane.id ? officePresetDraft.file : ""}
                                      onChange={(event) => setOfficePresetDraft((current) => ({
                                        ...current,
                                        harnessId: selectedPane.id,
                                        file: event.target.value,
                                      }))}
                                      placeholder="docs/example.docx"
                                    />
                                  </label>
                                  {officePresetDraft.preset === "create" ? (
                                    <label>
                                      Create Type
                                      <select
                                        value={officePresetDraft.kind}
                                        onChange={(event) => setOfficePresetDraft((current) => ({
                                          ...current,
                                          harnessId: selectedPane.id,
                                          kind: event.target.value as "docx" | "xlsx" | "pptx",
                                        }))}
                                      >
                                        <option value="docx">docx</option>
                                        <option value="xlsx">xlsx</option>
                                        <option value="pptx">pptx</option>
                                      </select>
                                    </label>
                                  ) : null}
                                  <button
                                    type="button"
                                    onClick={() => void runOfficePreset()}
                                    disabled={officePresetBusy || !officePresetDraft.file.trim() || officePresetDraft.harnessId !== selectedPane.id}
                                  >
                                    {officePresetBusy ? "Running..." : "Run Preset"}
                                  </button>
                                </div>
                              ) : null}

                              <div className="tool-action-row">
                                <button
                                  type="button"
                                  onClick={() => void saveHarnessCapabilities(selectedPane.id)}
                                  disabled={harnessCapabilitySavingId === selectedPane.id}
                                >
                                  {harnessCapabilitySavingId === selectedPane.id ? "Saving..." : "Save Extras"}
                                </button>
                                <button
                                  type="button"
                                  className="ghost"
                                  onClick={() => setHarnessExtrasOpenByHarness((current) => ({ ...current, [selectedPane.id]: false }))}
                                >
                                  Close
                                </button>
                              </div>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    <textarea
                      value={composer}
                      onChange={(event) => setComposer(event.target.value)}
                      placeholder="Ask your selected harness..."
                      rows={4}
                    />
                    <div className="composer-actions">
                      <div className="composer-inline-tools">
                        <button
                          type="button"
                          className={`ghost chip-icon-button compact ${autoSpeakHarnessReplies ? "is-active" : ""}`}
                          onClick={() => {
                            if (autoSpeakHarnessReplies) {
                              stopHarnessSpeech();
                            }
                            setAutoSpeakHarnessReplies((current) => !current);
                          }}
                          title={`Voice replies ${autoSpeakHarnessReplies ? "on" : "off"}`}
                          aria-label={`Voice replies ${autoSpeakHarnessReplies ? "on" : "off"}`}
                        >
                          <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
                            {autoSpeakHarnessReplies ? (
                              <path d="M5 9v6h4l5 5V4L9 9H5zm10.5 3a4.5 4.5 0 0 0-2.2-3.85v7.7A4.5 4.5 0 0 0 15.5 12zm2.5 0a7 7 0 0 1-3.4 6.02l-1.02-1.68A5 5 0 0 0 16 12a5 5 0 0 0-2.42-4.34l1.02-1.68A7 7 0 0 1 18 12z" fill="currentColor" />
                            ) : (
                              <path d="M4.27 3 3 4.27 7.73 9H5v6h4l5 5v-6.73L19.73 19 21 17.73 4.27 3zM14 4.27v4.61l-2-2V9l2 2V20l-5-5H5V9h3.73L14 4.27z" fill="currentColor" />
                            )}
                          </svg>
                        </button>
                        <button
                          type="button"
                          className="ghost chip-icon-button compact"
                          onClick={() => {
                            setRightTab("diagnostics");
                            const card = document.getElementById("failed-tasks-card");
                            setTimeout(() => card?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 60);
                          }}
                          title={`Failed tasks (${failedTasks.length})`}
                          aria-label={`Failed tasks (${failedTasks.length})`}
                        >
                          <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
                            <path d="M12 2 1 21h22L12 2zm1 14h-2v2h2v-2zm0-6h-2v5h2V10z" fill="currentColor" />
                          </svg>
                        </button>
                        {selectedPane.type === "agent" ? (
                          <button
                            type="button"
                            className={`ghost chip-icon-button compact ${activeHarnessExtrasOpen ? "is-active" : ""}`}
                            onClick={() => setHarnessExtrasOpenByHarness((current) => ({
                              ...current,
                              [selectedPane.id]: !current[selectedPane.id],
                            }))}
                            title="Harness extras"
                            aria-label="Harness extras"
                          >
                            <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
                              <path d="M19.14 12.94a7.96 7.96 0 0 0 .06-.94 7.96 7.96 0 0 0-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.28 7.28 0 0 0-1.63-.94l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54c-.58.22-1.12.53-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.71 8.84a.5.5 0 0 0 .12.64l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32c.13.22.39.31.6.22l2.39-.96c.51.41 1.05.72 1.63.94l.36 2.54c.04.24.25.42.5.42h3.84c.25 0 .46-.18.5-.42l.36-2.54c.58-.22 1.12-.53 1.63-.94l2.39.96c.22.09.47 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58zM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7z" fill="currentColor" />
                            </svg>
                          </button>
                        ) : null}
                      </div>
                      <button type="button" className="ghost" disabled>
                        Mic (STT)
                      </button>
                      <button type="button" className="ghost" disabled>
                        Upload
                      </button>
                      {chatBusy ? (
                        <button type="button" className="stop-btn" onClick={() => void onStopStream()}>
                          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                            <rect x="6" y="6" width="12" height="12" rx="1" fill="currentColor" />
                          </svg>
                          Stop
                        </button>
                      ) : (
                        <button type="button" onClick={() => void onSendMessage()} disabled={!composer.trim()}>
                          Send
                        </button>
                      )}
                    </div>
                  </footer>
                    </>
                  )}
                </div>
              </div>
            </div>
          ) : null}
        </section>

        <aside className="pane pane-right">
          <div className="pane-right-header">
            <button
              type="button"
              className={`tab-btn ${rightTab === "workspace" ? "active" : ""}`}
              onClick={() => setRightTab("workspace")}
            >
              Workspace
            </button>
            <button
              type="button"
              className={`tab-btn ${rightTab === "diagnostics" ? "active" : ""}`}
              onClick={() => setRightTab("diagnostics")}
            >
              Diagnostics
              {diagnosticsAlertCount > 0 ? <span className="tab-alert" aria-label="Diagnostics alerts">!</span> : null}
            </button>
          </div>

          {rightTab === "workspace" ? (
            <>
              <label className="workspace-switcher">
                Active Workspace
                <select
                  value={boot?.activeWorkspaceId ?? "default"}
                  onChange={(event) => void onSwitchWorkspace(event.target.value)}
                >
                  {boot?.workspaces.map((workspace) => (
                    <option key={workspace.id} value={workspace.id}>
                      {workspace.name}
                    </option>
                  ))}
                </select>
              </label>

              <form className="workspace-create" onSubmit={(event) => void onCreateWorkspace(event)}>
                <input
                  type="text"
                  value={createWorkspaceName}
                  placeholder="new workspace name"
                  onChange={(event) => setCreateWorkspaceName(event.target.value)}
                />
                <button type="button" className="ghost" onClick={() => void openWorkspaceBrowser()}>
                  Browse Folder
                </button>
                <button type="submit">Create</button>
              </form>

              {workspacePathDraft ? (
                <small className="workspace-path-draft">Using folder: {workspacePathDraft}</small>
              ) : (
                <small className="workspace-path-draft">No folder selected: workspace will be created in default Nexus workspace storage.</small>
              )}

              {workspaceBrowserOpen ? (
                <section className="workspace-browser" aria-live="polite">
                  <div className="workspace-browser-header">
                    <strong>Select Workspace Folder</strong>
                    <button type="button" className="ghost" onClick={closeWorkspaceBrowser}>Close</button>
                  </div>

                  {workspaceBrowsePath ? (
                    <>
                      <small>Current: {workspaceBrowsePath}</small>
                      <div className="workspace-browser-actions">
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => workspaceBrowseParentPath && void browseWorkspacePath(workspaceBrowseParentPath)}
                          disabled={!workspaceBrowseParentPath || workspaceBrowseBusy}
                        >
                          Up
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setWorkspacePathDraft(workspaceBrowsePath);
                            closeWorkspaceBrowser();
                          }}
                          disabled={workspaceBrowseBusy}
                        >
                          Use This Folder
                        </button>
                      </div>
                    </>
                  ) : null}

                  {!workspaceBrowsePath ? (
                    <ul className="workspace-root-list">
                      {workspaceRoots.map((root) => (
                        <li key={root}>
                          <button type="button" className="ghost" onClick={() => void browseWorkspacePath(root)}>{root}</button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <ul className="workspace-folder-list">
                      {workspaceBrowseFolders.map((folder) => (
                        <li key={folder.path}>
                          <button type="button" className="ghost" onClick={() => void browseWorkspacePath(folder.path)}>
                            {folder.name}
                          </button>
                        </li>
                      ))}
                      {workspaceBrowseFolders.length === 0 ? <li><small>No subfolders found.</small></li> : null}
                    </ul>
                  )}
                </section>
              ) : null}

              <ul className="workspace-list">
                {boot?.workspaces.map((workspace) => (
                  <li key={workspace.id}>
                    <div>
                      <strong>{workspace.name}</strong>
                      <small>{formatBytes(workspace.sizeBytes)} | active agents: {workspace.activeHarnesses.length}</small>
                      <small>{workspace.path}</small>
                    </div>
                    <button type="button" className="ghost" onClick={() => void onDeleteWorkspace(workspace.id)}>
                      Delete
                    </button>
                  </li>
                ))}
              </ul>

              <section className="tree-panel">
                <div className="tree-panel-head">
                  <h3>File Tree</h3>
                  <button type="button" className="ghost" onClick={() => void openActiveWorkspaceFolder()}>
                    Open Folder
                  </button>
                </div>
                {workspaceTree ? <ul className="tree-root">{renderTree(workspaceTree)}</ul> : <p>Loading workspace tree...</p>}
              </section>
            </>
          ) : null}

          {rightTab === "diagnostics" ? (
            <>
              <section className="startup-panel">
                <h3>Startup Readiness</h3>
                <small>
                  live harnesses: {boot?.startup.liveHarnesses ?? 0}/{boot?.startup.totalHarnesses ?? 0}
                </small>
                {lastStartupCheck ? (() => {
                  const { label, ageClass } = formatCheckAge(lastStartupCheck.timestamp);
                  return (
                    <small className="startup-history">
                      <span className={ageClass}>last check: {label}</span>
                      {lastStartupCheck.readiness.ready ? (
                        <span className="badge-ok"> ✓ READY</span>
                      ) : (
                        <span className="badge-blocked"> ! BLOCKED</span>
                      )}
                    </small>
                  );
                })() : null}
                <button type="button" className="ghost" onClick={() => void onRunStartupCheck()} disabled={startupChecking}>
                  {startupChecking ? "Checking..." : "Run Startup Check"}
                </button>
                <label className="extras-toggle">
                  <input
                    type="checkbox"
                    checked={startupStrictMode}
                    onChange={(event) => void saveStartupStrictMode(event.target.checked)}
                    disabled={startupStrictModeSaving}
                  />
                  <span>Strict startup mode (block chat until readiness passes)</span>
                </label>
                {startupCheckDetails?.managedStatuses?.length ? (
                  <ul className="diagnostic-list">
                    {startupCheckDetails.managedStatuses.map((status) => (
                      <li key={`${status.harnessId}-${status.endpoint}`}>
                        <strong>{status.harnessId}</strong> · {status.mode} · <small>{status.detail}</small>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {startupCheckDetails?.selfRepairReport ? (
                  <details>
                    <summary>Self-Repair Report</summary>
                    <ul className="diagnostic-list">
                      <li>
                        <strong>Attempts</strong>
                        <small>{startupCheckDetails.selfRepairReport.attempted} attempted · {startupCheckDetails.selfRepairReport.completed} completed · {startupCheckDetails.selfRepairReport.failed} failed</small>
                      </li>
                      {startupCheckDetails.selfRepairReport.recent.map((job) => (
                        <li key={job.id}>
                          <strong>{job.action}</strong>
                          <small>{job.status} · {new Date(job.updatedAt).toLocaleString()}{job.error ? ` · ${job.error}` : ""}</small>
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </section>

              <section className="startup-panel">
                <div className="failed-tasks-header">
                  <h3>Web Capability Diagnostics</h3>
                  <button type="button" className="ghost" onClick={() => void loadWebCapabilityDiagnostics()} disabled={webCapabilityDiagnosticsBusy}>
                    {webCapabilityDiagnosticsBusy ? "Checking..." : "Refresh"}
                  </button>
                </div>
                {webCapabilityDiagnostics ? (
                  <>
                    <small>Checked: {new Date(webCapabilityDiagnostics.checkedAt).toLocaleString()}</small>
                    <ul className="diagnostic-list">
                      <li>
                        <strong>Crawl4AI</strong> · {webCapabilityDiagnostics.probes.crawl4ai.available ? "available" : "missing"}
                        <small>{webCapabilityDiagnostics.probes.crawl4ai.command}</small>
                      </li>
                      <li>
                        <strong>OfficeCLI</strong> · {webCapabilityDiagnostics.probes.officecli.available ? "available" : "missing"}
                        <small>{webCapabilityDiagnostics.probes.officecli.command}</small>
                      </li>
                    </ul>
                    <details>
                      <summary>Harness Capability Matrix</summary>
                      <ul className="diagnostic-list">
                        {webCapabilityDiagnostics.harnessCapabilitySummary.map((entry) => (
                          <li key={entry.harnessId}>
                            <strong>{entry.harnessName}</strong>
                            <small>fable={entry.fableModeEnabled ? "on" : "off"} · crawl={entry.crawl4aiEnabled ? "on" : "off"} · office={entry.officeCliEnabled ? "on" : "off"} · domains={entry.crawlAllowlistCount}</small>
                          </li>
                        ))}
                      </ul>
                    </details>
                    {webCapabilityDiagnostics.policyWarnings?.length ? (
                      <details>
                        <summary>Policy Warnings</summary>
                        <ul className="diagnostic-list">
                          {webCapabilityDiagnostics.policyWarnings.map((warning, idx) => (
                            <li key={`${warning}-${idx}`}><strong>Warning</strong><small>{warning}</small></li>
                          ))}
                        </ul>
                      </details>
                    ) : null}
                    {webCapabilityDiagnostics.history ? (
                      <details>
                        <summary>Recent Capability Runs</summary>
                        <ul className="diagnostic-list">
                          {webCapabilityDiagnostics.history.crawl4aiRuns.slice(0, 5).map((run) => (
                            <li key={run.id}>
                              <strong>Crawl4AI · {run.harnessId}</strong>
                              <small>{run.status} · {run.domain} · {Math.round(run.durationMs)}ms</small>
                            </li>
                          ))}
                          {webCapabilityDiagnostics.history.officeCliRuns.slice(0, 5).map((run) => (
                            <li key={run.id}>
                              <strong>OfficeCLI · {run.harnessId}</strong>
                              <small>{run.status} · {run.file} · {run.preset ?? "manual"}</small>
                            </li>
                          ))}
                        </ul>
                      </details>
                    ) : null}
                    {webCapabilityDiagnostics.fableTelemetry?.length ? (
                      <details>
                        <summary>Fable Telemetry</summary>
                        <ul className="diagnostic-list">
                          {webCapabilityDiagnostics.fableTelemetry.map((entry) => (
                            <li key={`${entry.harnessId}-${entry.profile}`}>
                              <strong>{entry.harnessId} · {entry.profile}</strong>
                              <small>total={entry.total} · success={entry.success} · fallback={entry.fallbackUsed}</small>
                            </li>
                          ))}
                        </ul>
                      </details>
                    ) : null}
                  </>
                ) : (
                  <p className="diagnostics-empty">No web capability diagnostics loaded yet.</p>
                )}
              </section>

              <section id="failed-tasks-card" className="failed-tasks-panel">
                <div className="failed-tasks-header">
                  <h3>Failed Tasks</h3>
                  <button type="button" className="ghost" onClick={() => void loadFailedTasks()}>
                    Refresh
                  </button>
                </div>

                {failedTasks.length === 0 ? <p className="diagnostics-empty">No resumable failures.</p> : null}

                <ul className="failed-task-list">
                  {failedTasks.slice(0, 5).map((task) => (
                    <li key={task.requestId}>
                      <div>
                        <strong>{task.harnessId}</strong>
                        <small>{new Date(task.updatedAt).toLocaleString()}</small>
                        <small>{task.error ?? "stream interrupted"}</small>
                      </div>
                      <div className="failed-task-actions">
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => setExpandedTaskId((current) => (current === task.requestId ? null : task.requestId))}
                        >
                          {expandedTaskId === task.requestId ? "Hide" : "View"}
                        </button>
                        <button
                          type="button"
                          onClick={() => void onResumeTask(task)}
                          disabled={resumeBusyId === task.requestId}
                        >
                          {resumeBusyId === task.requestId ? "Resuming..." : "Resume"}
                        </button>
                      </div>
                      {expandedTaskId === task.requestId ? (
                        <pre className="failed-task-preview">{task.partialOutput || "No partial output"}</pre>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
            </>
          ) : null}
        </aside>
      </section>
    </main>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default App;
