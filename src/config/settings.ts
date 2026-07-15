import { getSetting, setSetting } from "../db";
import type { AgentConfig } from "../agent";

export const defaultSettings: AgentConfig = { apiKey: "", baseUrl: "https://api.deepseek.com", model: "deepseek-v4-flash", temperature: 0.7 };
export async function loadSettings(): Promise<AgentConfig> { const value = await getSetting("agent_config"); if (!value) return defaultSettings; try { return { ...defaultSettings, ...(JSON.parse(value) as Partial<AgentConfig>) }; } catch { return defaultSettings; } }
export async function saveSettings(settings: AgentConfig) { await setSetting("agent_config", JSON.stringify(settings)); }
