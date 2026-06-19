export type HarnessConfig = {
  id: string;
  name: string;
  endpoint: string;
  models: string[];
  defaultModel: string;
  adapter?: {
    protocol?: "openai" | "generic" | "hybrid";
    streamProtocol?: "openai-sse" | "custom-sse" | "none";
    authMode?: "bearer" | "x-api-key" | "both" | "none";
    healthPath?: string;
    openAiPath?: string;
    genericPaths?: string[];
    streamPath?: string;
    customHeaders?: Record<string, string>;
  };
};

export type ToolConfig = {
  id: string;
  name: string;
  status: "online" | "offline" | "setup-required";
};

export type WorkspaceRecord = {
  id: string;
  name: string;
  path: string;
  sizeBytes: number;
  lastModified: string;
  activeHarnesses: string[];
};

export type SystemState = {
  onboardingComplete: boolean;
  activeWorkspaceId: string;
  selectedPane: {
    type: "agent" | "tool";
    id: string;
  };
  router9: {
    apiKey: string;
    baseUrl: string;
    defaultModel: string;
    fallbackOrder: string[];
    providers: Array<{
      id: string;
      name: string;
      health: "healthy" | "degraded" | "offline";
      latencyMs: number;
    }>;
    logs: Array<{
      timestamp: string;
      level: "info" | "warn" | "error";
      message: string;
    }>;
  };
  nexusRouter?: {
    providers: Array<{
      id: string;
      name: string;
      type: "openai-compatible" | "openrouter";
      baseUrl: string;
      apiKey: string;
      enabled: boolean;
      defaultModel?: string;
      models?: string[];
      lastSyncedAt?: string;
    }>;
    fallbackChain: Array<{
      providerId: string;
      model: string;
    }>;
    harnessAssignments: NexusRouterHarnessAssignments;
    retryPolicy: {
      maxAttempts: number;
      backoffMs: number;
      retryOnStatus: number[];
    };
    logs: Array<{
      timestamp: string;
      level: "info" | "warn" | "error";
      message: string;
    }>;
  };
  harnessAutomation?: HarnessAutomationStore;
};

export type NexusRouterProvider = {
  id: string;
  name: string;
  type: "openai-compatible" | "openrouter";
  baseUrl: string;
  apiKey: string;
  enabled: boolean;
  defaultModel?: string;
  models?: string[];
  lastSyncedAt?: string;
};

export type NexusRouterFallbackTarget = {
  providerId: string;
  model: string;
};

export type NexusRouterHarnessAssignments = Record<string, NexusRouterFallbackTarget[]>;

export type NexusRouterRetryPolicy = {
  maxAttempts: number;
  backoffMs: number;
  retryOnStatus: number[];
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
};

export type HarnessConformanceCheck = {
  name: string;
  passed: boolean;
  details: string;
};

export type HarnessConformanceResult = {
  harnessId: string;
  harnessName: string;
  endpoint: string;
  timestamp: string;
  checks: HarnessConformanceCheck[];
  score: {
    passed: number;
    total: number;
  };
};

export type TaskRecordStatus = "running" | "failed" | "completed" | "aborted";

export type TaskRecord = {
  requestId: string;
  harnessId: string;
  workspaceId: string;
  mode: "sync" | "stream";
  message: string;
  history: ChatMessage[];
  startedAt: string;
  updatedAt: string;
  status: TaskRecordStatus;
  partialOutput: string;
  finalOutput?: string;
  error?: string;
  meta?: {
    model: string;
    provider: string;
    fallbackUsed: boolean;
    elapsedMs: number;
    tokenUsage: {
      input: number;
      output: number;
    };
  };
};

export type StartupReadiness = {
  ready: boolean;
  blockers: string[];
  onboardingComplete: boolean;
  liveHarnesses: number;
  totalHarnesses: number;
  checkedAt: string;
};

export type HarnessSchedule = {
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

export type HarnessRunRecord = {
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

export type HarnessAutomationStore = {
  schedulesByWorkspace: Record<string, Record<string, HarnessSchedule[]>>;
  runsByWorkspace: Record<string, Record<string, HarnessRunRecord[]>>;
};