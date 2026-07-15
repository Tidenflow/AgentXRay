import { fetch } from "@tauri-apps/plugin-http";
import { sanitizeModelPayload } from "./parsing";
import type { AgentConfig } from "./types";

export const runChatCompletion = async (requestPayload: unknown, config: AgentConfig) => {
  const upstream = await fetch(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, { method: "POST", headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify(requestPayload) });
  const responseText = await upstream.text(); let parsed: unknown = null;
  try { parsed = responseText ? JSON.parse(responseText) : null; } catch { parsed = { error: { message: responseText || "The provider returned an invalid JSON response." } }; }
  return { ok: upstream.ok, status: upstream.status, responsePayload: sanitizeModelPayload(parsed) };
};

export const assertRunnable = (input: { messages: unknown[] }, config: AgentConfig) => {
  if (!config.apiKey.trim()) throw new Error("请先在运行设置中填写并保存 API key。");
  if (!input.messages.length) throw new Error("Messages are required.");
};
export const providerError = (label: string, status: number, payload: unknown) => new Error(`${label} (${status}): ${JSON.stringify(payload)}`);
