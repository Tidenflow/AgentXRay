import { assertRunnable, providerError, runChatCompletion } from "./client";
import { createObservationMessage, createReActToolExecution, finalAnswerFromContent, parseReActResponse, reactToolGuide } from "./parsing";
import { localToolDefinitions } from "./tools";
import type { AgentConfig, ChatMessage, ModelResponse, ReActResult, ReActStep, RunInput } from "./types";

export async function runReact(input: RunInput, config: AgentConfig): Promise<ReActResult> {
  assertRunnable(input, config); const maxRounds = Math.max(1, Math.min(input.maxRounds ?? 4, 8)); const temperature = input.temperature ?? config.temperature; const startedAt = performance.now();
  const reactSteps: ReActStep[] = []; let loopMessages: ChatMessage[] = input.messages; let finalAnswer = ""; let finalRequestPayload: unknown = null; let finalResponsePayload: unknown = null;
  for (let round = 1; round <= maxRounds; round += 1) {
    const requestPayload = { model: config.model, temperature, messages: loopMessages }; const completion = await runChatCompletion(requestPayload, config);
    if (!completion.ok) throw providerError("DeepSeek ReAct round request failed", completion.status, completion.responsePayload);
    const content = (completion.responsePayload as ModelResponse)?.choices?.[0]?.message?.content ?? ""; const parsed = parseReActResponse(content); const step: ReActStep = { round, assistantContent: content, parsed, requestPayload, responsePayload: completion.responsePayload }; reactSteps.push(step);
    if (parsed.finalAnswer) { finalAnswer = parsed.finalAnswer; finalResponsePayload = completion.responsePayload; break; }
    const execution = createReActToolExecution(round, parsed); const observation = createObservationMessage(execution); step.toolExecution = execution; step.observationMessage = observation; loopMessages = [...loopMessages, { role: "assistant", content }, observation];
  }
  if (!finalAnswer) { finalRequestPayload = { model: config.model, temperature, messages: [...loopMessages, { role: "user" as const, content: "Max ReAct rounds reached. Produce the best concise response now using the observations. Start with Final Answer:" }] }; const completion = await runChatCompletion(finalRequestPayload, config); if (!completion.ok) throw providerError("DeepSeek ReAct final answer request failed", completion.status, completion.responsePayload); finalResponsePayload = completion.responsePayload; finalAnswer = finalAnswerFromContent((completion.responsePayload as ModelResponse)?.choices?.[0]?.message?.content ?? ""); }
  return { baseUrl: config.baseUrl, model: config.model, durationMs: Math.round(performance.now() - startedAt), requestPayload: reactSteps[0]?.requestPayload ?? null, responsePayload: reactSteps[0]?.responsePayload ?? null, toolDefinitions: localToolDefinitions, reactToolGuide, reactSteps, finalRequestPayload, finalResponsePayload, finalAnswer, maxRounds };
}
