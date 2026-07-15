import { assertRunnable, providerError, runChatCompletion } from "./client";
import { createToolResultMessage, executeLocalTool, localToolDefinitions } from "./tools";
import type { AgentConfig, ModelResponse, RunInput, ToolCallingResult } from "./types";

export async function runToolCalling(input: RunInput, config: AgentConfig): Promise<ToolCallingResult> {
  assertRunnable(input, config); const startedAt = performance.now(); const temperature = input.temperature ?? config.temperature;
  const requestPayload = { model: config.model, temperature, messages: input.messages, tools: localToolDefinitions, tool_choice: "auto" as const };
  const first = await runChatCompletion(requestPayload, config); if (!first.ok) throw providerError("DeepSeek tool-calling request failed", first.status, first.responsePayload);
  const firstMessage = (first.responsePayload as ModelResponse)?.choices?.[0]?.message; const toolExecutions = (firstMessage?.tool_calls ?? []).map(executeLocalTool); const toolMessages = toolExecutions.map(createToolResultMessage);
  const followUpRequestPayload = toolMessages.length ? { model: config.model, temperature, messages: firstMessage ? [...input.messages, firstMessage, ...toolMessages] : [...input.messages, ...toolMessages] } : null;
  const followUp = followUpRequestPayload ? await runChatCompletion(followUpRequestPayload, config) : null;
  if (followUp && !followUp.ok) throw providerError("DeepSeek final answer request failed after tool execution", followUp.status, followUp.responsePayload);
  return { baseUrl: config.baseUrl, model: config.model, durationMs: Math.round(performance.now() - startedAt), requestPayload, responsePayload: first.responsePayload as ModelResponse, toolDefinitions: localToolDefinitions, toolExecutions, followUpRequestPayload, followUpResponsePayload: followUp?.responsePayload as ModelResponse ?? null };
}
