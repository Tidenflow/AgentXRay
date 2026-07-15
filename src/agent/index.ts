import type { AgentModeId } from "../types";
import { runBasic } from "./runBasic";
import { runPlanExecute } from "./runPlanExecute";
import { runReact } from "./runReact";
import { runToolCalling } from "./runToolCalling";
import type { AgentConfig, RunInput } from "./types";

export const runMode = (mode: AgentModeId, input: RunInput, config: AgentConfig) => {
  switch (mode) { case "tool-calling": return runToolCalling(input, config); case "react": return runReact(input, config); case "plan-execute": return runPlanExecute(input, config); default: return runBasic(input, config); }
};
export type { AgentConfig, DeepSeekResult, PlanExecuteResult, ReActResult, ToolCallingResult } from "./types";
