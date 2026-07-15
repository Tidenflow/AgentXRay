import type { PlanExecuteStep, ReActParsedStep, ReActStep, RuntimeMessage, ToolCall, ToolExecution } from "../types";

export type ChatMessage = {
  role: RuntimeMessage["role"];
  content: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
};

export type ToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: { type: "object"; properties: Record<string, unknown>; required?: string[]; additionalProperties: boolean };
  };
};

export type AgentConfig = { apiKey: string; baseUrl: string; model: string; temperature: number };
export type RunInput = { messages: ChatMessage[]; temperature?: number; maxRounds?: number };

export type DeepSeekResult = {
  baseUrl: string; model: string; durationMs: number;
  requestPayload: { model: string; temperature: number; messages: ChatMessage[] };
  responsePayload: ModelResponse;
};
export type ModelResponse = { choices?: Array<{ message?: ChatMessage }> } | null;
export type ToolCallingResult = DeepSeekResult & {
  toolDefinitions: ToolDefinition[]; toolExecutions: ToolExecution[];
  followUpRequestPayload: DeepSeekResult["requestPayload"] | null;
  followUpResponsePayload: ModelResponse;
};
export type ReActResult = {
  baseUrl: string; model: string; durationMs: number; requestPayload: unknown; responsePayload: unknown;
  toolDefinitions: ToolDefinition[]; reactToolGuide: string; reactSteps: ReActStep[];
  finalRequestPayload: unknown | null; finalResponsePayload: unknown | null; finalAnswer: string; maxRounds: number;
};
export type PlanExecuteResult = {
  baseUrl: string; model: string; durationMs: number; plannerRequestPayload: unknown;
  plannerResponsePayload: unknown; plan: string[]; steps: PlanExecuteStep[];
  synthesizerRequestPayload: unknown; synthesizerResponsePayload: unknown; finalAnswer: string;
  toolDefinitions: ToolDefinition[]; error?: string;
};
export type { PlanExecuteStep, ReActParsedStep, ReActStep, ToolCall, ToolExecution };
