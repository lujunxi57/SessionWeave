export type Harness = 'codex' | 'opencode';
export interface Conversation {
  id: string; harness: Harness; title: string; preview: string; cwd: string;
  updatedAt: number; state: 'idle' | 'running' | 'unloaded' | 'unavailable';
  model?: string; effort?: string; loaded?: boolean; canSend?: boolean;
  testing?: boolean;
}
export interface Resource { id: string; name: string; description?: string; path?: string }
export interface ModelSelection { id: string; providerID?: string; effort?: string }
export interface ModelOption { id: string; name: string; providerID?: string; providerName: string; efforts: string[]; defaultEffort: string }
export interface ModelCatalog { models: ModelOption[]; current: ModelSelection; conversation: Conversation; source: 'session' | 'preset' }
export interface Step {
  id: string; conversationRef: { harness: Harness; id: string }; purpose: string;
  mode: 'kickoff' | 'listen'; promptTemplate: string; selectedSkills: string[];
  selectedFiles: string[]; upstreamOutputRefs: string[]; polishBeforeSend: boolean;
  position: { x: number; y: number };
}
export interface Workflow { id: string; name: string; nodes: Step[]; edges: { id: string; source: string; target: string }[] }
export type RunState = 'queued' | 'listening' | 'polishing' | 'running' | 'approval' | 'succeeded' | 'failed';
export interface NodeRun {
  id: string; nodeId: string; state: RunState; inputTemplate: string; actualSentPrompt?: string;
  outputSnapshot?: string; nativeTurnOrMessageId?: string; model?: string; effort?: string;
  startedAt?: number; completedAt?: number; error?: string; activity?: string;
}
export interface WorkflowRun {
  id: string; workflow: Workflow; state: 'running' | 'paused' | 'succeeded' | 'failed';
  createdAt: number; completedAt?: number; nodes: NodeRun[];
  testing?: boolean;
}
export interface NativeResult { id: string; text: string; model?: string; effort?: string }
export interface Activity { state?: RunState; text: string; nativeId?: string }
export interface HarnessAdapter {
  list(): Promise<Conversation[]>;
  create(title: string, testing?: boolean, preset?: ModelSelection): Promise<Conversation>;
  resources(id: string): Promise<{ skills: Resource[]; commands: Resource[] }>;
  send(id: string, text: string, skills: string[], files: string[], update: (a: Activity) => void, beforeSend?: () => Promise<void>): Promise<NativeResult>;
  listen(id: string, update: (a: Activity) => void): Promise<NativeResult>;
}
