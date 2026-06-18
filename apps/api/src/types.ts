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
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
};