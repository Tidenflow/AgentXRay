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
