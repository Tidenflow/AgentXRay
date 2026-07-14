export type AgentModeId = "basic" | "tool-calling" | "react" | "plan-execute";

export type MessageRole = "system" | "user" | "assistant" | "tool";

export type MessageSource =
  | "user_input"
  | "system_prompt"
  | "agent_runtime"
  | "model_response"
  | "tool_result"
  | "planner"
  | "executor"
  | "synthesizer";

export type ToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

export type RuntimeMessage = {
  id: string;
  role: MessageRole;
  content?: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
  source: MessageSource;
};

export type ToolExecution = {
  toolCall: ToolCall;
  name: string;
  arguments: unknown;
  content: string;
  ok: boolean;
  error?: string;
};

export type RuntimeActor = "user" | "runtime" | "model" | "provider" | "tool";

export type RuntimeVisibility = "observed" | "inferred" | "provider-managed";

export type RuntimeStepKind =
  | "input"
  | "context"
  | "model"
  | "provider"
  | "decision"
  | "parse"
  | "tool"
  | "observation"
  | "output";

export type RuntimeArtifact = {
  label: string;
  value: unknown;
  format?: "text" | "json" | "code";
};

export type RuntimeStep = {
  id: string;
  kind: RuntimeStepKind;
  title: string;
  summary: string;
  actor: RuntimeActor;
  visibility: RuntimeVisibility;
  transitionReason: string;
  input?: RuntimeArtifact[];
  output?: RuntimeArtifact[];
  stateChange?: RuntimeArtifact[];
  raw?: RuntimeArtifact[];
};

export type ReActParsedStep = {
  thought?: string;
  action?: string;
  actionInput?: unknown;
  finalAnswer?: string;
  parseError?: string;
};

export type ReActStep = {
  round: number;
  assistantContent: string;
  parsed: ReActParsedStep;
  toolExecution?: ToolExecution;
  observationMessage?: {
    role: "user";
    content: string;
  };
  requestPayload: unknown;
  responsePayload: unknown;
};

export type PlanExecuteStep = {
  step: number;
  description: string;
  executorSystemPrompt: string;
  executorRequestPayload: unknown;
  executorResponsePayload: unknown;
  toolExecutions: ToolExecution[];
  followUpRequestPayload: unknown | null;
  followUpResponsePayload: unknown | null;
  stepResult: string;
};

export type TraceRun = {
  id: string;
  mode: AgentModeId;
  modeName: string;
  description: string;
  turnNumber: number;
  userPrompt: string;
  finalAnswer: string;
  temperature: number;
  model: string;
  durationMs: number;
  requestPayload: unknown;
  responsePayload: unknown;
  requestMessages: RuntimeMessage[];
  memoryMessages: RuntimeMessage[];
  conversationMessages: RuntimeMessage[];
  assistantMessage: RuntimeMessage;
};
