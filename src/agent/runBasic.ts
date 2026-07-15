import { assertRunnable, providerError, runChatCompletion } from "./client";
import type { AgentConfig, DeepSeekResult, RunInput } from "./types";

export async function runBasic(input: RunInput, config: AgentConfig): Promise<DeepSeekResult> {
  assertRunnable(input, config); const startedAt = performance.now();
  const requestPayload = { model: config.model, temperature: input.temperature ?? config.temperature, messages: input.messages };
  const completion = await runChatCompletion(requestPayload, config);
  if (!completion.ok) throw providerError("DeepSeek API request failed", completion.status, completion.responsePayload);
  return { baseUrl: config.baseUrl, model: config.model, durationMs: Math.round(performance.now() - startedAt), requestPayload, responsePayload: completion.responsePayload as DeepSeekResult["responsePayload"] };
}
