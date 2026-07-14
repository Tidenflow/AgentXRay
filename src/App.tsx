import { type PointerEvent as ReactPointerEvent, type ReactNode, useMemo, useState } from "react";
import {
  Activity,
  AlertCircle,
  CircleDot,
  History,
  Inbox,
  Layers3,
  MessageSquareText,
  PanelRightOpen,
  Play,
  Plus,
  SendHorizontal,
  Settings2,
  Wrench,
} from "lucide-react";
import type { AgentModeId, PlanExecuteStep, ReActStep, RuntimeMessage, RuntimeStep, ToolExecution, TraceRun } from "./types";
import { runtimeStepsFromTrace } from "./runtime/traceSteps";

type InspectorTab = "input" | "output" | "tools" | "memory" | "raw";

type AgentModeOption = {
  id: AgentModeId;
  name: string;
  description: string;
  enabled: boolean;
};

type Experiment = {
  id: string;
  prompt: string;
  createdAt: number;
  runs: TraceRun[];
  errors: Partial<Record<AgentModeId, string>>;
};

type DeepSeekResult = {
  baseUrl: string;
  model: string;
  durationMs: number;
  requestPayload: {
    model: string;
    temperature: number;
    messages: Array<{
      role: RuntimeMessage["role"];
      content: string | null;
      name?: string;
      tool_call_id?: string;
      tool_calls?: RuntimeMessage["tool_calls"];
    }>;
  };
  responsePayload: {
    choices?: Array<{
      message?: {
        role?: RuntimeMessage["role"];
        content?: string | null;
        tool_calls?: RuntimeMessage["tool_calls"];
      };
    }>;
  };
};

type ToolCallingResult = DeepSeekResult & {
  toolDefinitions: unknown[];
  toolExecutions: ToolExecution[];
  followUpRequestPayload: DeepSeekResult["requestPayload"] | null;
  followUpResponsePayload: DeepSeekResult["responsePayload"] | null;
};

type ReActResult = {
  baseUrl: string;
  model: string;
  durationMs: number;
  requestPayload: unknown;
  responsePayload: unknown;
  toolDefinitions: unknown[];
  reactToolGuide: string;
  reactSteps: ReActStep[];
  finalRequestPayload: unknown | null;
  finalResponsePayload: unknown | null;
  finalAnswer: string;
  maxRounds: number;
};

type PlanExecuteResult = {
  baseUrl: string;
  model: string;
  durationMs: number;
  plannerRequestPayload: unknown;
  plannerResponsePayload: unknown;
  plan: string[];
  steps: PlanExecuteStep[];
  synthesizerRequestPayload: unknown;
  synthesizerResponsePayload: unknown;
  finalAnswer: string;
  toolDefinitions: unknown[];
};

const modeOptions: AgentModeOption[] = [
  {
    id: "basic",
    name: "Basic LLM",
    description: "真实 DeepSeek 请求：system + user + assistant。",
    enabled: true,
  },
  {
    id: "tool-calling",
    name: "Tool Calling",
    description: "真实 tool_call + 本地工具执行 + 二次 LLM 汇总。",
    enabled: true,
  },
  {
    id: "react",
    name: "ReAct",
    description: "Action / Observation 循环，多轮推理，工具执行与最终答案合成。",
    enabled: true,
  },
  {
    id: "plan-execute",
    name: "Plan-and-Execute",
    description: "Planner → Executor → Synthesizer 三阶段流水线，计划分解与逐步执行。",
    enabled: true,
  },
];

const tabs: Array<{ id: InspectorTab; label: string; icon: typeof SendHorizontal }> = [
  { id: "input", label: "Sent to LLM", icon: SendHorizontal },
  { id: "output", label: "LLM Response", icon: Inbox },
  { id: "tools", label: "Tool Calls", icon: Wrench },
  { id: "memory", label: "Memory", icon: History },
  { id: "raw", label: "Raw Trace", icon: Layers3 },
];

const sourceForRole = (role: RuntimeMessage["role"]): RuntimeMessage["source"] => {
  if (role === "system") return "system_prompt";
  if (role === "user") return "user_input";
  if (role === "tool") return "tool_result";
  return "model_response";
};

const toRuntimeMessage = (
  id: string,
  role: RuntimeMessage["role"],
  content: string | null,
  options: Pick<RuntimeMessage, "name" | "tool_call_id" | "tool_calls"> = {},
): RuntimeMessage => ({
  id,
  role,
  content,
  source: sourceForRole(role),
  ...options,
});

const toApiMessage = (message: RuntimeMessage) => ({
  role: message.role,
  content: message.content ?? null,
  ...(message.name ? { name: message.name } : {}),
  ...(message.tool_call_id ? { tool_call_id: message.tool_call_id } : {}),
  ...(message.tool_calls ? { tool_calls: message.tool_calls } : {}),
});

const systemPromptMessage = (): RuntimeMessage =>
  toRuntimeMessage(
    "system-prompt",
    "system",
    "You are a helpful assistant. Respond directly to the user prompt.",
  );

const toolCallingSystemPromptMessage = (): RuntimeMessage =>
  toRuntimeMessage(
    "tool-system-prompt",
    "system",
    "You are a helpful assistant. Use the provided tools when they can answer the user more accurately. After tool results are provided, explain the final answer directly and briefly.",
  );

const reactSystemPromptMessage = (): RuntimeMessage =>
  toRuntimeMessage(
    "react-system-prompt",
    "system",
    `You are a helpful assistant that solves problems step by step using the ReAct (Reasoning + Acting) framework.

You have access to these tools:
- calculate: Evaluate a deterministic arithmetic expression. Supports +, -, *, /, %, ^, parentheses, and decimals.
- get_current_datetime: Get the current date and time for a requested IANA time zone.

You MUST respond in exactly this format:

Thought: <your step-by-step reasoning about what to do next>
Action: <tool name>
Action Input: <JSON object with the tool parameters>

After receiving an Observation, continue with another cycle, or finish with:

Thought: <your final reasoning>
Final Answer: <your concise answer to the user in natural language>

Always start with a Thought. Use exactly ONE Action per response. Never output anything outside this format.`,
  );

const planExecuteSystemPromptMessage = (): RuntimeMessage =>
  toRuntimeMessage(
    "plan-execute-system-prompt",
    "system",
    "You are a helpful assistant. The runtime will handle planning and execution automatically.",
  );

const buildTraceFromDeepSeek = (
  prompt: string,
  result: DeepSeekResult,
  turnNumber: number,
): TraceRun => {
  const requestMessages = result.requestPayload.messages.map((message, index) =>
    toRuntimeMessage(`request-${index + 1}`, message.role, message.content),
  );
  const currentUserIndex = requestMessages.reduce(
    (latestIndex, message, index) => (message.role === "user" ? index : latestIndex),
    -1,
  );
  const currentUserMessage = requestMessages[currentUserIndex];
  const memoryMessages = requestMessages.filter(
    (message, index) => message.role !== "system" && index !== currentUserIndex,
  );
  const assistantContent = result.responsePayload.choices?.[0]?.message?.content ?? "";
  const assistantMessage = toRuntimeMessage(
    `turn-${turnNumber}-assistant`,
    "assistant",
    assistantContent,
  );

  const userOnly = currentUserMessage ? [currentUserMessage] : [];
  const conversationMessages = [...memoryMessages, currentUserMessage, assistantMessage].filter(
    Boolean,
  ) as RuntimeMessage[];
  const now = Date.now();

  return {
    id: `trace-${now}`,
    mode: "basic",
    modeName: "Basic LLM",
    description: "真实 DeepSeek 请求生成的 trace。",
    turnNumber,
    userPrompt: prompt,
    finalAnswer: assistantContent,
    temperature: result.requestPayload.temperature,
    model: result.model,
    durationMs: result.durationMs,
    requestPayload: result.requestPayload,
    responsePayload: result.responsePayload,
    requestMessages,
    memoryMessages,
    conversationMessages,
    assistantMessage,
  };
};

const toRuntimeMessages = (
  prefix: string,
  messages: ToolCallingResult["requestPayload"]["messages"],
) =>
  messages.map((message, index) =>
    toRuntimeMessage(`${prefix}-${index + 1}`, message.role, message.content, {
      name: message.name,
      tool_call_id: message.tool_call_id,
      tool_calls: message.tool_calls,
    }),
  );

const buildTraceFromToolCalling = (
  prompt: string,
  result: ToolCallingResult,
  turnNumber: number,
): TraceRun => {
  const initialMessages = toRuntimeMessages("tool-request-initial", result.requestPayload.messages);
  const currentUserIndex = initialMessages.reduce(
    (latestIndex, message, index) => (message.role === "user" ? index : latestIndex),
    -1,
  );
  const currentUserMessage = initialMessages[currentUserIndex];
  const memoryMessages = initialMessages.filter(
    (message, index) => message.role !== "system" && index !== currentUserIndex,
  );
  const firstAssistantPayload = result.responsePayload.choices?.[0]?.message ?? {
    role: "assistant" as const,
    content: null,
  };
  const toolCallMessage =
    firstAssistantPayload.tool_calls && firstAssistantPayload.tool_calls.length > 0
      ? toRuntimeMessage(`turn-${turnNumber}-assistant-tool-call`, "assistant", null, {
          tool_calls: firstAssistantPayload.tool_calls,
        })
      : null;
  const toolResultMessages = result.toolExecutions.map((execution, index) =>
    toRuntimeMessage(`turn-${turnNumber}-tool-${index + 1}`, "tool", execution.content, {
      name: execution.name,
      tool_call_id: execution.toolCall.id,
    }),
  );
  const finalResponsePayload = result.followUpResponsePayload ?? result.responsePayload;
  const finalAssistantPayload =
    finalResponsePayload.choices?.[0]?.message ?? firstAssistantPayload;
  const finalAssistantContent = finalAssistantPayload.content ?? "";
  const assistantMessage = toRuntimeMessage(
    `turn-${turnNumber}-assistant-final`,
    "assistant",
    finalAssistantContent,
    {
      tool_calls:
        result.toolExecutions.length === 0 ? finalAssistantPayload.tool_calls : undefined,
    },
  );
  const conversationMessages = [
    ...memoryMessages,
    currentUserMessage,
    toolCallMessage,
    ...toolResultMessages,
    assistantMessage,
  ].filter(Boolean) as RuntimeMessage[];
  const now = Date.now();

  return {
    id: `trace-${now}`,
    mode: "tool-calling",
    modeName: "Tool Calling",
    description: "真实 DeepSeek tool_call 与本地工具执行生成的 trace。",
    turnNumber,
    userPrompt: prompt,
    finalAnswer: finalAssistantContent,
    temperature: result.requestPayload.temperature,
    model: result.model,
    durationMs: result.durationMs,
    requestPayload: {
      initialRequestPayload: result.requestPayload,
      toolDefinitions: result.toolDefinitions,
      toolExecutions: result.toolExecutions,
      followUpRequestPayload: result.followUpRequestPayload,
    },
    responsePayload: {
      initialResponsePayload: result.responsePayload,
      toolExecutions: result.toolExecutions,
      followUpResponsePayload: result.followUpResponsePayload,
    },
    requestMessages: result.followUpRequestPayload
      ? toRuntimeMessages("tool-request-final", result.followUpRequestPayload.messages)
      : initialMessages,
    memoryMessages,
    conversationMessages,
    assistantMessage,
  };
};

const buildTraceFromReAct = (
  prompt: string,
  result: ReActResult,
  turnNumber: number,
): TraceRun => {
  const initialReqMessages =
    (
      result.requestPayload as {
        messages?: Array<{ role: string; content: string | null }>;
      }
    )?.messages?.map((msg, i) =>
      toRuntimeMessage(`react-req-${i + 1}`, msg.role as RuntimeMessage["role"], msg.content),
    ) ?? [];

  const currentUserIndex = initialReqMessages.reduce(
    (latestIndex, message, index) => (message.role === "user" ? index : latestIndex),
    -1,
  );
  const currentUserMessage = initialReqMessages[currentUserIndex];
  const memoryMessages = initialReqMessages.filter(
    (message, index) => message.role !== "system" && index !== currentUserIndex,
  );

  const assistantMessage = toRuntimeMessage(
    `turn-${turnNumber}-assistant`,
    "assistant",
    result.finalAnswer,
  );

  const conversationMessages = (
    currentUserMessage
      ? [...memoryMessages, currentUserMessage, assistantMessage]
      : [assistantMessage]
  ).filter(Boolean) as RuntimeMessage[];

  const now = Date.now();

  return {
    id: `trace-${now}`,
    mode: "react",
    modeName: "ReAct",
    description: `ReAct loop: ${result.reactSteps.length} round(s) of max ${result.maxRounds}.`,
    turnNumber,
    userPrompt: prompt,
    finalAnswer: result.finalAnswer,
    temperature:
      (result.requestPayload as { temperature?: number })?.temperature ?? 0.7,
    model: result.model,
    durationMs: result.durationMs,
    requestPayload: result,
    responsePayload: result,
    requestMessages: initialReqMessages,
    memoryMessages,
    conversationMessages,
    assistantMessage,
  };
};

const buildTraceFromPlanExecute = (
  prompt: string,
  result: PlanExecuteResult,
  turnNumber: number,
): TraceRun => {
  // Build request messages from planner payload
  const plannerReq = result.plannerRequestPayload as {
    messages?: Array<{ role: string; content: string | null }>;
  };
  const requestMessages =
    plannerReq?.messages?.map((msg, i) =>
      toRuntimeMessage(`plan-req-${i + 1}`, msg.role as RuntimeMessage["role"], msg.content),
    ) ?? [];

  const currentUserIndex = requestMessages.reduce(
    (latestIndex, message, index) => (message.role === "user" ? index : latestIndex),
    -1,
  );
  const currentUserMessage = requestMessages[currentUserIndex];
  const memoryMessages = requestMessages.filter(
    (message, index) => message.role !== "system" && index !== currentUserIndex,
  );

  const assistantMessage = toRuntimeMessage(
    `turn-${turnNumber}-assistant`,
    "assistant",
    result.finalAnswer,
  );

  const conversationMessages = (
    currentUserMessage
      ? [...memoryMessages, currentUserMessage, assistantMessage]
      : [assistantMessage]
  ).filter(Boolean) as RuntimeMessage[];

  const now = Date.now();

  return {
    id: `trace-${now}`,
    mode: "plan-execute",
    modeName: "Plan-and-Execute",
    description: `Plan: ${result.plan.length} step(s), ${result.steps.length} executed.`,
    turnNumber,
    userPrompt: prompt,
    finalAnswer: result.finalAnswer,
    temperature:
      (result.plannerRequestPayload as { temperature?: number })?.temperature ?? 0.7,
    model: result.model,
    durationMs: result.durationMs,
    requestPayload: result,
    responsePayload: result,
    requestMessages,
    memoryMessages,
    conversationMessages,
    assistantMessage,
  };
};

export function App() {
  const [sidebarWidth, setSidebarWidth] = useState(232);
  const [workspaceWidth, setWorkspaceWidth] = useState(720);
  const [activeResize, setActiveResize] = useState<"sidebar" | "workspace" | null>(null);
  const [temperature, setTemperature] = useState(0.7);
  const [systemPrompt, setSystemPrompt] = useState("");
  const [showRunSettings, setShowRunSettings] = useState(false);
  const [activeMode, setActiveMode] = useState<AgentModeId>("basic");
  const [prompt, setPrompt] = useState("");
  const [conversationMessages, setConversationMessages] = useState<RuntimeMessage[]>([]);
  const [traces, setTraces] = useState<TraceRun[]>([]);
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [activeExperimentId, setActiveExperimentId] = useState<string | null>(null);
  const [selectedModes, setSelectedModes] = useState<AgentModeId[]>(["basic", "tool-calling"]);
  const [runningMode, setRunningMode] = useState<AgentModeId | null>(null);
  const [activeTraceId, setActiveTraceId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<InspectorTab>("input");
  const [activeStepId, setActiveStepId] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeTrace = useMemo(
    () => traces.find((trace) => trace.id === activeTraceId) ?? null,
    [activeTraceId, traces],
  );
  const runtimeSteps = useMemo(
    () => (activeTrace ? runtimeStepsFromTrace(activeTrace) : []),
    [activeTrace],
  );
  const activeStep =
    runtimeSteps.find((step) => step.id === activeStepId) ?? runtimeSteps[0] ?? null;

  const selectTrace = (trace: TraceRun) => {
    setActiveTraceId(trace.id);
    setActiveTab("input");
    setActiveStepId(null);
    setActiveMode(trace.mode);
    setPrompt(trace.userPrompt);
    setConversationMessages(trace.conversationMessages);
    const experiment = experiments.find((item) => item.runs.some((run) => run.id === trace.id));
    setActiveExperimentId(experiment?.id ?? null);
  };

  const executeMode = async (mode: AgentModeId, cleanPrompt: string) => {
      const turnNumber = 1;
      const userMessage = toRuntimeMessage(`turn-${turnNumber}-user`, "user", cleanPrompt);
      const defaultSystemMessage =
        mode === "tool-calling"
          ? toolCallingSystemPromptMessage()
          : mode === "react"
            ? reactSystemPromptMessage()
            : mode === "plan-execute"
              ? planExecuteSystemPromptMessage()
              : systemPromptMessage();
      const systemMessage = systemPrompt.trim()
        ? {
            ...defaultSystemMessage,
            content: `${defaultSystemMessage.content}\n\nAdditional system instructions:\n${systemPrompt.trim()}`,
          }
        : defaultSystemMessage;
      const requestMessages = [systemMessage, userMessage];
      const endpoint =
        mode === "tool-calling"
          ? "/api/deepseek/tool-calling"
          : mode === "react"
            ? "/api/deepseek/react"
            : mode === "plan-execute"
              ? "/api/deepseek/plan-execute"
              : "/api/deepseek/chat";
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: requestMessages.map(toApiMessage),
          temperature,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "DeepSeek request failed.");
      return mode === "tool-calling"
        ? buildTraceFromToolCalling(cleanPrompt, payload as ToolCallingResult, turnNumber)
        : mode === "react"
          ? buildTraceFromReAct(cleanPrompt, payload as ReActResult, turnNumber)
          : mode === "plan-execute"
            ? buildTraceFromPlanExecute(cleanPrompt, payload as PlanExecuteResult, turnNumber)
            : buildTraceFromDeepSeek(cleanPrompt, payload as DeepSeekResult, turnNumber);
  };

  const runTrace = async () => {
    const cleanPrompt = prompt.trim();
    if (!cleanPrompt || isRunning || selectedModes.length === 0) return;

    setIsRunning(true);
    setError(null);
    const experimentId = `experiment-${Date.now()}`;
    const experiment: Experiment = { id: experimentId, prompt: cleanPrompt, createdAt: Date.now(), runs: [], errors: {} };
    setExperiments((current) => [experiment, ...current]);
    setActiveExperimentId(experimentId);
    setActiveTraceId(null);

    for (const mode of selectedModes) {
      setRunningMode(mode);
      try {
        const trace = await executeMode(mode, cleanPrompt);
        setTraces((current) => [trace, ...current]);
        setExperiments((current) => current.map((item) => item.id === experimentId ? { ...item, runs: [...item.runs, trace] } : item));
        setActiveMode(trace.mode);
        setActiveTraceId(trace.id);
        setConversationMessages(trace.conversationMessages);
      } catch (runError) {
        const message = runError instanceof Error ? runError.message : "未知运行错误。";
        setExperiments((current) => current.map((item) => item.id === experimentId ? { ...item, errors: { ...item.errors, [mode]: message } } : item));
        setError(message);
      }
    }

    setRunningMode(null);
    setIsRunning(false);
    setActiveTab("input");
    setActiveStepId(null);
    setPrompt("");
  };

  const selectedMode = modeOptions.find((mode) => mode.id === activeMode) ?? modeOptions[0];

  const startResize = (
    target: "sidebar" | "workspace",
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    event.preventDefault();
    const startX = event.clientX;
    const startSidebarWidth = sidebarWidth;
    const startWorkspaceWidth = workspaceWidth;
    setActiveResize(target);

    const onMove = (moveEvent: PointerEvent) => {
      const delta = moveEvent.clientX - startX;
      if (target === "sidebar") {
        setSidebarWidth(Math.max(180, Math.min(360, startSidebarWidth + delta)));
        return;
      }

      const availableWidth = window.innerWidth - sidebarWidth - 4 - 4 - 380;
      setWorkspaceWidth(Math.max(440, Math.min(availableWidth, startWorkspaceWidth + delta)));
    };

    const onUp = () => {
      setActiveResize(null);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <main
      className={`app-shell ${activeResize ? "is-resizing" : ""}`}
      style={{ gridTemplateColumns: `${sidebarWidth}px 4px ${workspaceWidth}px 4px minmax(380px, 1fr)` }}
    >
      <Sidebar
        activeTrace={activeTrace}
        experiments={experiments}
        onNewTrace={() => {
          setActiveTraceId(null);
          setActiveExperimentId(null);
          setActiveStepId(null);
          setPrompt("");
          setConversationMessages([]);
          setError(null);
        }}
        onSelectTrace={selectTrace}
      />
      <div
        aria-label="调整实验栏宽度"
        className={`pane-resizer ${activeResize === "sidebar" ? "is-active" : ""}`}
        onDoubleClick={() => setSidebarWidth(232)}
        onPointerDown={(event) => startResize("sidebar", event)}
        role="separator"
      />
      <ChatPane
        error={error}
        isRunning={isRunning}
        mode={selectedMode}
        onPromptChange={setPrompt}
        onRun={runTrace}
        prompt={prompt}
        trace={activeTrace}
        visibleMessages={activeTrace?.conversationMessages ?? conversationMessages}
        runtimeSteps={runtimeSteps}
        activeStepId={activeStep?.id ?? null}
        onSelectStep={setActiveStepId}
        experiment={experiments.find((item) => item.id === activeExperimentId) ?? null}
        onSelectTrace={selectTrace}
        selectedModes={selectedModes}
        onToggleMode={(mode) => setSelectedModes((current) => current.includes(mode) ? current.filter((item) => item !== mode) : [...current, mode])}
        runningMode={runningMode}
        temperature={temperature}
        onTemperatureChange={setTemperature}
        systemPrompt={systemPrompt}
        onSystemPromptChange={setSystemPrompt}
        showRunSettings={showRunSettings}
        onToggleRunSettings={() => setShowRunSettings((current) => !current)}
      />
      <div
        aria-label="调整运行时间线宽度"
        className={`pane-resizer ${activeResize === "workspace" ? "is-active" : ""}`}
        onDoubleClick={() => setWorkspaceWidth(720)}
        onPointerDown={(event) => startResize("workspace", event)}
        role="separator"
      />
      {selectedMode.id === "basic" || selectedMode.id === "tool-calling" ? (
        <RuntimeStepInspector step={activeStep} trace={activeTrace} />
      ) : (
        <TraceInspector activeTab={activeTab} setActiveTab={setActiveTab} trace={activeTrace} />
      )}
    </main>
  );
}

function Sidebar({
  activeTrace,
  experiments,
  onNewTrace,
  onSelectTrace,
}: {
  activeTrace: TraceRun | null;
  experiments: Experiment[];
  onNewTrace: () => void;
  onSelectTrace: (trace: TraceRun) => void;
}) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">
          <Activity size={18} />
        </div>
        <div>
          <h1>AgentXRay</h1>
          <p>Agent Runtime Explorer</p>
        </div>
      </div>

      <button className="new-trace-button" onClick={onNewTrace}>
        <Plus size={16} />
        新建实验
      </button>

      <section className="nav-section">
        <div className="section-label">实验记录</div>
        <div className="history-list">
          {experiments.length === 0 ? (
            <div className="empty-list">还没有实验。输入一个问题，并选择要比较的 Agent 模式。</div>
          ) : (
            experiments.map((experiment) => (
              <article className="experiment-item" key={experiment.id}>
                <div className="experiment-title"><MessageSquareText size={14} /><span>{experiment.prompt}</span></div>
                <div className="experiment-runs">
                  {experiment.runs.map((trace) => (
                    <button className={activeTrace?.id === trace.id ? "is-active" : ""} key={trace.id} onClick={() => onSelectTrace(trace)}>
                      <span className="run-status-dot" />{trace.modeName}<small>{trace.durationMs}ms</small>
                    </button>
                  ))}
                  {Object.entries(experiment.errors).map(([mode]) => <div className="experiment-error" key={mode}>! {mode} 运行失败</div>)}
                  {experiment.runs.length === 0 && Object.keys(experiment.errors).length === 0 ? <div className="experiment-pending">等待运行…</div> : null}
                </div>
              </article>
            ))
          )}
        </div>
      </section>
    </aside>
  );
}

function ChatPane({
  error,
  isRunning,
  mode,
  onPromptChange,
  onRun,
  prompt,
  trace,
  visibleMessages,
  runtimeSteps,
  activeStepId,
  onSelectStep,
  experiment,
  onSelectTrace,
  selectedModes,
  onToggleMode,
  runningMode,
  temperature,
  onTemperatureChange,
  systemPrompt,
  onSystemPromptChange,
  showRunSettings,
  onToggleRunSettings,
}: {
  error: string | null;
  isRunning: boolean;
  mode: AgentModeOption;
  onPromptChange: (prompt: string) => void;
  onRun: () => void;
  prompt: string;
  trace: TraceRun | null;
  visibleMessages: RuntimeMessage[];
  runtimeSteps: RuntimeStep[];
  activeStepId: string | null;
  onSelectStep: (id: string) => void;
  experiment: Experiment | null;
  onSelectTrace: (trace: TraceRun) => void;
  selectedModes: AgentModeId[];
  onToggleMode: (mode: AgentModeId) => void;
  runningMode: AgentModeId | null;
  temperature: number;
  onTemperatureChange: (value: number) => void;
  systemPrompt: string;
  onSystemPromptChange: (value: string) => void;
  showRunSettings: boolean;
  onToggleRunSettings: () => void;
}) {
  const chatMessages = visibleMessages.filter((message) => {
    if (message.role === "user" || message.role === "tool") return true;
    return message.role === "assistant" && (!!message.content || !!message.tool_calls?.length);
  });

  const isReActTrace = trace?.mode === "react" && isReActResult(trace.requestPayload);
  const isPlanExecuteTrace =
    trace?.mode === "plan-execute" && isPlanExecuteResult(trace.requestPayload);

  return (
    <section className="chat-pane">
      <header className="chat-header">
        <div>
          <div className="eyebrow">Agent 运行时</div>
          <h2>{mode.name} 执行过程</h2>
        </div>
        <div className="model-pill">
          <CircleDot size={14} />
          {trace?.model ?? "deepseek-v4-pro"}
        </div>
      </header>

      <nav className="experiment-tabs" aria-label="实验结果">
          {experiment?.runs.map((run) => (
            <button className={trace?.id === run.id ? "is-active" : ""} key={run.id} onClick={() => onSelectTrace(run)}>
              <span className="run-status-dot" />{run.modeName}<small>{run.durationMs}ms</small>
            </button>
          ))}
          {!experiment?.runs.length ? <span className="experiment-tabs-empty">实验结果会显示在这里</span> : null}
      </nav>

      <div className="chat-scroll">
        {mode.id === "basic" || mode.id === "tool-calling" ? (
          <RuntimeTimeline
            activeStepId={activeStepId}
            mode={mode.id}
            onSelectStep={onSelectStep}
            steps={runtimeSteps}
          />
        ) : isReActTrace ? (
          <ReActChatView
            result={trace!.requestPayload as ReActResult}
            userPrompt={trace!.userPrompt}
          />
        ) : isPlanExecuteTrace ? (
          <PlanExecuteChatView
            result={trace!.requestPayload as PlanExecuteResult}
            userPrompt={trace!.userPrompt}
          />
        ) : chatMessages.length > 0 ? (
          chatMessages.map((message) => (
            <article
              className={`chat-message ${
                message.role === "assistant"
                  ? "assistant-message"
                  : message.role === "tool"
                    ? "tool-message"
                    : "user-message"
              }`}
              key={message.id}
            >
              <div className="message-author">
                {message.role === "assistant"
                  ? "Assistant"
                  : message.role === "tool"
                    ? `Tool${message.name ? ` · ${message.name}` : ""}`
                    : "You"}
              </div>
              {message.tool_calls?.length ? (
                <div className="tool-call-list">
                  {message.tool_calls.map((toolCall) => (
                    <span key={toolCall.id}>
                      <Wrench size={14} />
                      {toolCall.function.name}
                    </span>
                  ))}
                </div>
              ) : null}
              <p>
                {message.content ||
                  (message.tool_calls?.length ? "Waiting for tool results." : "No content returned.")}
              </p>
            </article>
          ))
        ) : (
          <div className="empty-chat">
            <h2>Start with a real prompt.</h2>
            <p>
              AgentXRay will send your text to DeepSeek, then show the complete input
              package, the complete output package, and how the next turn carries memory.
            </p>
          </div>
        )}
      </div>

      <footer className="composer">
        <div className="composer-toolbar">
          <span className="run-config-summary">Temperature {temperature.toFixed(1)}</span>
          <button aria-expanded={showRunSettings} aria-label="运行参数" className={showRunSettings ? "is-active" : ""} onClick={onToggleRunSettings}>
            <Settings2 size={15} />
          </button>
        </div>
        {showRunSettings ? (
          <section className="run-settings-panel">
            <label className="temperature-control">
              <span><strong>Temperature</strong><small>输出随机性</small></span>
              <input
                max="2"
                min="0"
                onChange={(event) => onTemperatureChange(Number(event.target.value))}
                step="0.1"
                type="range"
                value={temperature}
              />
              <output>{temperature.toFixed(1)}</output>
            </label>
            <label className="system-prompt-control">
              <span><strong>System Prompt</strong><small>与各模式的运行协议合并</small></span>
              <textarea
                onChange={(event) => onSystemPromptChange(event.target.value)}
                placeholder="输入系统提示词；留空时使用模式默认值"
                spellCheck={false}
                value={systemPrompt}
              />
            </label>
          </section>
        ) : null}
        {error ? (
          <div className="error-banner">
            <AlertCircle size={15} />
            {error}
          </div>
        ) : null}
        <div className="mode-selector" aria-label="选择运行模式">
          {modeOptions.map((option) => {
            const selected = selectedModes.includes(option.id);
            const running = runningMode === option.id;
            return (
              <button className={selected ? "is-selected" : ""} disabled={isRunning} key={option.id} onClick={() => onToggleMode(option.id)}>
                <span>{running ? "◌" : selected ? "✓" : "+"}</span>{option.name}
              </button>
            );
          })}
        </div>
        <div className="input-row">
          <textarea
            aria-label="Prompt"
            disabled={isRunning || !mode.enabled}
            onChange={(event) => onPromptChange(event.target.value)}
            placeholder="输入 prompt..."
            spellCheck={false}
            value={prompt}
          />
          <button
            className="run-button"
            aria-label="Run trace"
            disabled={isRunning || !prompt.trim() || selectedModes.length === 0}
            onClick={onRun}
          >
            {isRunning ? <span className="run-progress">{selectedModes.findIndex((item) => item === runningMode) + 1}/{selectedModes.length}</span> : <Play size={16} />}
          </button>
        </div>
      </footer>
    </section>
  );
}

function RuntimeTimeline({
  activeStepId,
  mode,
  onSelectStep,
  steps,
}: {
  activeStepId: string | null;
  mode: AgentModeId;
  onSelectStep: (id: string) => void;
  steps: RuntimeStep[];
}) {
  const preview = mode === "tool-calling"
    ? ["声明可用工具", "模型选择下一步", "模型服务解析", "参数解析与路由", "执行工具", "回填工具结果", "生成最终回答"]
    : ["接收用户目标", "组装模型请求", "模型生成 Token", "模型服务包装响应", "提取最终回答"];

  return (
    <div className="runtime-timeline">
      <div className="runtime-intro">
        <span>{steps.length ? "真实运行时间线" : "执行流程预览"}</span>
        <h3>{steps.length ? "这次运行内部发生了什么" : "运行后，Agent 内部会发生什么"}</h3>
        <p>{steps.length
          ? "沿着时间线观察模型输出如何变成 Runtime 行动。选择任意步骤查看依据。"
          : "这里不以对话为中心，而是展示谁执行了操作、状态发生了什么变化，以及为什么进入下一步。"}</p>
      </div>
      {steps.length === 0 ? (
        <div className="runtime-preview">
          {preview.map((title, index) => (
            <div className="runtime-preview-step" key={title}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <strong>{title}</strong>
            </div>
          ))}
          <div className="runtime-preview-note">
            <Wrench size={16} />
            <span>{mode === "tool-calling"
              ? "可以尝试：现在上海几点？请使用时间工具。"
              : "可以尝试：解释一下天空为什么是蓝色的。"}</span>
          </div>
        </div>
      ) : steps.map((runtimeStep, index) => (
        <button
          className={`runtime-step-card ${activeStepId === runtimeStep.id ? "is-active" : ""}`}
          key={runtimeStep.id}
          onClick={() => onSelectStep(runtimeStep.id)}
        >
          <span className="runtime-step-index">{String(index + 1).padStart(2, "0")}</span>
          <span className={`runtime-step-dot actor-${runtimeStep.actor}`} />
          <span className="runtime-step-copy">
            <span className="runtime-step-meta">
              {actorLabel(runtimeStep.actor)} · {visibilityLabel(runtimeStep.visibility)}
            </span>
            <strong>{runtimeStep.title}</strong>
            <small>{runtimeStep.summary}</small>
          </span>
        </button>
      ))}
    </div>
  );
}

function RuntimeStepInspector({ step, trace }: { step: RuntimeStep | null; trace: TraceRun | null }) {
  return (
    <aside className="inspector runtime-step-inspector">
      <header className="inspector-header">
        <div>
          <div className="eyebrow">运行步骤</div>
          <h2>{step?.title ?? "选择一个步骤"}</h2>
        </div>
        <span className="model-pill"><CircleDot size={14} />{trace?.model ?? "DeepSeek"}</span>
      </header>
      {step ? (
        <div className="step-detail-scroll">
          <section className="step-explanation">
            <div className="step-badges">
              <span>{actorLabel(step.actor)}</span><span>{visibilityLabel(step.visibility)}</span>
            </div>
            <p>{step.summary}</p>
          </section>
          <section className="why-card">
            <div className="section-label">为什么进入下一步</div>
            <p>{step.transitionReason}</p>
          </section>
          <ArtifactSection title="输入" artifacts={step.input} />
          <ArtifactSection title="输出" artifacts={step.output} />
          <ArtifactSection title="状态变化" artifacts={step.stateChange} />
          <ArtifactSection title="原始依据" artifacts={step.raw} />
        </div>
      ) : (
        <div className="inspector-empty-runtime">
          <div className="empty-runtime-mark"><Activity size={22} /></div>
          <h3>选择一个运行步骤</h3>
          <p>运行后，这里会解释每项数据由谁产生、为什么发生下一步，以及哪些信息可以直接观察。</p>
          <div className="visibility-legend">
            <span><i className="observed-dot" />直接观察</span>
            <span><i className="inferred-dot" />合理推断</span>
            <span><i className="provider-dot" />模型服务内部处理</span>
          </div>
        </div>
      )}
    </aside>
  );
}

const actorLabel = (actor: RuntimeStep["actor"]) => ({
  user: "用户",
  runtime: "Agent Runtime",
  model: "模型",
  provider: "模型服务",
  tool: "工具",
})[actor];

const visibilityLabel = (visibility: RuntimeStep["visibility"]) => ({
  observed: "直接观察",
  inferred: "合理推断",
  "provider-managed": "服务内部处理",
})[visibility];

function ArtifactSection({ title, artifacts }: { title: string; artifacts?: RuntimeStep["input"] }) {
  if (!artifacts?.length) return null;
  return (
    <section className="artifact-section">
      <div className="section-label">{title}</div>
      {artifacts.map((artifact, index) => (
        <div className="artifact" key={`${artifact.label}-${index}`}>
          <strong>{artifact.label}</strong>
          {artifact.format === "text" ? <p>{String(artifact.value ?? "")}</p> : (
            <pre>{artifact.format === "code" ? String(artifact.value ?? "") : JSON.stringify(artifact.value, null, 2)}</pre>
          )}
        </div>
      ))}
    </section>
  );
}

function TraceInspector({
  activeTab,
  setActiveTab,
  trace,
}: {
  activeTab: InspectorTab;
  setActiveTab: (tab: InspectorTab) => void;
  trace: TraceRun | null;
}) {
  return (
    <aside className="inspector">
      <header className="inspector-header">
        <div>
          <div className="eyebrow">Runtime Inspector</div>
          <h2>Trace Detail</h2>
        </div>
        <button className="icon-button" aria-label="Toggle inspector">
          <PanelRightOpen size={17} />
        </button>
      </header>

      <nav className="inspector-flow" aria-label="Inspector views">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              className={activeTab === tab.id ? "is-active" : ""}
              disabled={!trace}
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
            >
              <Icon size={15} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="detail-view">
        {trace ? (
          <InspectorPanel trace={trace} tab={activeTab} />
        ) : (
          <div className="empty-panel">No LLM input, output, or memory context yet.</div>
        )}
      </div>
    </aside>
  );
}

function InspectorPanel({ trace, tab }: { trace: TraceRun; tab: InspectorTab }) {
  if (tab === "input") {
    return <FullInputPackage trace={trace} />;
  }

  if (tab === "output") {
    return <FullOutputPackage trace={trace} />;
  }

  if (tab === "tools") {
    return <ToolCallsPackage trace={trace} />;
  }

  if (tab === "memory") {
    return <MemoryPackage trace={trace} />;
  }

  return <RawTracePackage trace={trace} />;
}

type ToolCallingRequestPayload = {
  initialRequestPayload?: unknown;
  toolDefinitions?: unknown;
  toolExecutions?: ToolExecution[];
  followUpRequestPayload?: unknown;
};

type ToolCallingResponsePayload = {
  initialResponsePayload?: unknown;
  toolExecutions?: ToolExecution[];
  followUpResponsePayload?: unknown;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

const isToolCallingRequestPayload = (value: unknown): value is ToolCallingRequestPayload =>
  isRecord(value) && "initialRequestPayload" in value;

const isToolCallingResponsePayload = (value: unknown): value is ToolCallingResponsePayload =>
  isRecord(value) && "initialResponsePayload" in value;

const isReActResult = (value: unknown): value is ReActResult =>
  isRecord(value) && "reactSteps" in value && "finalAnswer" in value;

const isPlanExecuteResult = (value: unknown): value is PlanExecuteResult =>
  isRecord(value) && "plan" in value && "steps" in value && "plannerRequestPayload" in value;

function ReActChatView({
  result,
  userPrompt,
}: {
  result: ReActResult;
  userPrompt: string;
}) {
  return (
    <>
      <article className="chat-message user-message">
        <div className="message-author">You</div>
        <p>{userPrompt}</p>
      </article>

      {result.reactSteps.map((step) => (
        <div className="react-round" key={`react-round-${step.round}`}>
          <div className="react-round-header">
            <span className="react-round-badge">Round {step.round}</span>
            <span className="react-round-duration">
              {step.round === result.reactSteps.length && result.finalAnswer
                ? "→ Final Answer"
                : "→ Observation"}
            </span>
          </div>

          {step.parsed.thought && (
            <div className="react-step react-thought-step">
              <div className="react-step-label">💭 Thought</div>
              <p>{step.parsed.thought}</p>
            </div>
          )}

          {step.parsed.parseError && (
            <div className="react-step react-error-step">
              <div className="react-step-label">
                <AlertCircle size={14} />
                Parse Warning
              </div>
              <p>{step.parsed.parseError}</p>
            </div>
          )}

          {step.parsed.action && (
            <div className="react-step react-action-step">
              <div className="react-step-label">
                🔧 Action: <code>{step.parsed.action}</code>
              </div>
              <pre>{JSON.stringify(step.parsed.actionInput, null, 2)}</pre>
            </div>
          )}

          {step.toolExecution && (
            <div className="react-step react-observation-step">
              <div className="react-step-label">
                {step.toolExecution.ok ? "✅" : "❌"} Observation
                {step.toolExecution.ok
                  ? ""
                  : ` · ${step.toolExecution.error ?? "Unknown error"}`}
              </div>
              <pre>{step.toolExecution.content}</pre>
            </div>
          )}
        </div>
      ))}

      {result.finalAnswer ? (
        <article className="chat-message assistant-message">
          <div className="message-author">Assistant (Final Answer)</div>
          <p>{result.finalAnswer}</p>
        </article>
      ) : result.finalRequestPayload ? (
        <article className="chat-message assistant-message">
          <div className="message-author">Assistant (Max Rounds Reached)</div>
          <p>
            The ReAct loop reached its round limit ({result.maxRounds}) and produced a
            best-effort synthesis.
          </p>
        </article>
      ) : null}

      <div className="react-summary">
        <span>
          {result.reactSteps.length} round{result.reactSteps.length !== 1 ? "s" : ""} ·{" "}
          {result.durationMs}ms · max {result.maxRounds}
        </span>
      </div>
    </>
  );
}

function PlanExecuteChatView({
  result,
  userPrompt,
}: {
  result: PlanExecuteResult;
  userPrompt: string;
}) {
  return (
    <>
      <article className="chat-message user-message">
        <div className="message-author">You</div>
        <p>{userPrompt}</p>
      </article>

      {/* Phase 1: Planner */}
      <div className="plan-phase">
        <div className="plan-phase-header">
          <span className="plan-phase-badge phase-planner">Phase 1 · Planner</span>
          <span className="plan-phase-summary">
            Generated {result.plan.length} step{result.plan.length !== 1 ? "s" : ""}
          </span>
        </div>
        <div className="plan-list">
          {result.plan.map((step, index) => (
            <div className="plan-step-item" key={`plan-step-${index}`}>
              <span className="plan-step-num">{index + 1}</span>
              <span>{step}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Phase 2: Executor */}
      {result.steps.map((step) => (
        <div className="plan-phase" key={`exec-step-${step.step}`}>
          <div className="plan-phase-header">
            <span className="plan-phase-badge phase-executor">Phase 2 · Step {step.step}</span>
            <span className="plan-phase-summary">
              {step.toolExecutions.length > 0
                ? `${step.toolExecutions.length} tool call(s)`
                : "direct reasoning"}
            </span>
          </div>

          <div className="plan-exec-step-desc">{step.description}</div>

          {step.toolExecutions.length > 0 && (
            <div className="plan-exec-tools">
              {step.toolExecutions.map((exec, i) => (
                <div className="plan-exec-tool-item" key={`exec-${step.step}-${i}`}>
                  <div className="plan-exec-tool-header">
                    <Wrench size={13} />
                    <code>{exec.name}</code>
                    <span>{exec.ok ? "✅" : "❌"}</span>
                  </div>
                  <pre>{JSON.stringify(exec.arguments, null, 2)}</pre>
                  <div className="plan-exec-tool-result">
                    <span className="plan-exec-tool-label">Result</span>
                    <pre>{exec.content}</pre>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="plan-exec-result">
            <span className="plan-exec-result-label">Step Result</span>
            <p>{step.stepResult || "(No result)"}</p>
          </div>
        </div>
      ))}

      {/* Phase 3: Synthesizer */}
      <div className="plan-phase">
        <div className="plan-phase-header">
          <span className="plan-phase-badge phase-synthesizer">Phase 3 · Synthesizer</span>
        </div>
      </div>

      {/* Final Answer */}
      <article className="chat-message assistant-message">
        <div className="message-author">Assistant (Synthesized Answer)</div>
        <p>{result.finalAnswer}</p>
      </article>

      <div className="react-summary">
        <span>
          {result.plan.length} step(s) · {result.steps.length} executed · {result.durationMs}ms
        </span>
      </div>
    </>
  );
}

function FullInputPackage({ trace }: { trace: TraceRun }) {
  if (isReActResult(trace.requestPayload)) {
    return <ReActInputPackage payload={trace.requestPayload} />;
  }

  if (isPlanExecuteResult(trace.requestPayload)) {
    return <PlanExecuteInputPackage payload={trace.requestPayload} />;
  }

  if (isToolCallingRequestPayload(trace.requestPayload)) {
    return <ToolCallingInputPackage payload={trace.requestPayload} />;
  }

  const payload = trace.requestPayload as {
    model?: string;
    temperature?: number;
    messages?: Array<{
      role: RuntimeMessage["role"];
      content: string | null;
      name?: string;
      tool_call_id?: string;
      tool_calls?: RuntimeMessage["tool_calls"];
    }>;
  };

  return (
    <section className="full-package">
      <header>
        <span>完整发送 JSON</span>
        <small>绿色部分是用户提示词</small>
      </header>
      <div className="json-compose">
        <span>{`{\n`}</span>
        <AnnotatedJsonBlock tone="neutral" label="model config">
          {`  "model": ${JSON.stringify(payload.model)},
  "temperature": ${JSON.stringify(payload.temperature)},`}
        </AnnotatedJsonBlock>
        {trace.requestMessages.map((message, index) => {
          const apiMessage = payload.messages?.[index] ?? {
            role: message.role,
            content: message.content ?? null,
          };
          const suffix = index === trace.requestMessages.length - 1 ? "\n" : ",\n";
          const prefix = index === 0 ? `  "messages": [\n` : "";
          const closing = index === trace.requestMessages.length - 1 ? `  ]\n}` : "";
          const isCurrentPrompt = message.role === "user" && message.content === trace.userPrompt;
          const label =
            message.role === "system"
              ? "system prompt"
              : isCurrentPrompt
                ? "current user prompt"
                : "conversation memory";
          const tone =
            message.role === "system" ? "warm" : isCurrentPrompt ? "green" : "neutral";
          const messageJson = `    ${JSON.stringify(apiMessage, null, 2).replace(/\n/g, "\n    ")}`;

          if (isCurrentPrompt) {
            return (
              <span key={`json-${message.id}`}>
                <AnnotatedJsonBlock tone={tone} label={label}>
                  {`${prefix}    {
      "role": ${JSON.stringify(apiMessage.role)},
      "content": `}
                  <span className="json-current-prompt">{JSON.stringify(apiMessage.content)}</span>
                  {`
    }${suffix}${closing}`}
                </AnnotatedJsonBlock>
              </span>
            );
          }

          return (
            <span key={`json-${message.id}`}>
              <AnnotatedJsonBlock tone={tone} label={label}>
                {prefix}
                {messageJson}
                {suffix}
                {closing}
              </AnnotatedJsonBlock>
            </span>
          );
        })}
      </div>
    </section>
  );
}

function ToolCallingInputPackage({
  payload,
}: {
  payload: ToolCallingRequestPayload;
}) {
  return (
    <section className="full-package">
      <header>
        <span>Tool Calling 输入链路</span>
        <small>schema → tool result → final request</small>
      </header>
      <div className="json-compose">
        <AnnotatedJsonBlock tone="warm" label="first request + tools">
          {JSON.stringify(payload.initialRequestPayload, null, 2)}
        </AnnotatedJsonBlock>
        <AnnotatedJsonBlock tone="green" label="available tool schemas">
          {JSON.stringify(payload.toolDefinitions ?? [], null, 2)}
        </AnnotatedJsonBlock>
        <AnnotatedJsonBlock tone="neutral" label="local tool execution">
          {JSON.stringify(payload.toolExecutions ?? [], null, 2)}
        </AnnotatedJsonBlock>
        <AnnotatedJsonBlock tone="purple" label="second request with tool results">
          {JSON.stringify(payload.followUpRequestPayload ?? "No tool call requested.", null, 2)}
        </AnnotatedJsonBlock>
      </div>
    </section>
  );
}

function ReActInputPackage({ payload }: { payload: ReActResult }) {
  const initialReq = payload.requestPayload as {
    messages?: Array<{ role: string; content: string | null }>;
  };

  return (
    <section className="full-package">
      <header>
        <span>ReAct 输入链路</span>
        <small>system prompt → tool guide → round-by-round requests</small>
      </header>
      <div className="json-compose">
        <AnnotatedJsonBlock tone="warm" label="initial request (system + context + user)">
          {JSON.stringify(payload.requestPayload, null, 2)}
        </AnnotatedJsonBlock>
        <AnnotatedJsonBlock tone="green" label="tool definitions">
          {JSON.stringify(payload.toolDefinitions ?? [], null, 2)}
        </AnnotatedJsonBlock>
        <AnnotatedJsonBlock tone="neutral" label="ReAct tool guide (injected into system prompt)">
          {JSON.stringify(payload.reactToolGuide, null, 2)}
        </AnnotatedJsonBlock>
        {payload.reactSteps.map((step, index) => (
          <AnnotatedJsonBlock
            key={`react-req-round-${step.round}`}
            tone={index === payload.reactSteps.length - 1 && payload.finalAnswer ? "purple" : "neutral"}
            label={`round ${step.round} request (${payload.finalAnswer && index === payload.reactSteps.length - 1 ? "final" : "tool call"})`}
          >
            {JSON.stringify(step.requestPayload, null, 2)}
          </AnnotatedJsonBlock>
        ))}
        {payload.finalRequestPayload ? (
          <AnnotatedJsonBlock tone="purple" label="final synthesis request (max rounds reached)">
            {JSON.stringify(payload.finalRequestPayload, null, 2)}
          </AnnotatedJsonBlock>
        ) : null}
      </div>
    </section>
  );
}

function PlanExecuteInputPackage({ payload }: { payload: PlanExecuteResult }) {
  return (
    <section className="full-package">
      <header>
        <span>Plan-and-Execute 输入链路</span>
        <small>planner → per-step executor requests → synthesizer</small>
      </header>
      <div className="json-compose">
        <AnnotatedJsonBlock tone="warm" label="planner request">
          {JSON.stringify(payload.plannerRequestPayload, null, 2)}
        </AnnotatedJsonBlock>
        <AnnotatedJsonBlock tone="green" label="tool definitions">
          {JSON.stringify(payload.toolDefinitions ?? [], null, 2)}
        </AnnotatedJsonBlock>
        {payload.steps.map((step) => (
          <span key={`pe-in-step-${step.step}`}>
            <AnnotatedJsonBlock
              tone="neutral"
              label={`step ${step.step} executor request`}
            >
              {JSON.stringify(step.executorRequestPayload, null, 2)}
            </AnnotatedJsonBlock>
            {step.followUpRequestPayload ? (
              <AnnotatedJsonBlock
                tone="purple"
                label={`step ${step.step} follow-up request (with tool results)`}
              >
                {JSON.stringify(step.followUpRequestPayload, null, 2)}
              </AnnotatedJsonBlock>
            ) : null}
          </span>
        ))}
        <AnnotatedJsonBlock tone="purple" label="synthesizer request">
          {JSON.stringify(payload.synthesizerRequestPayload, null, 2)}
        </AnnotatedJsonBlock>
      </div>
    </section>
  );
}

function FullOutputPackage({ trace }: { trace: TraceRun }) {
  if (isReActResult(trace.responsePayload)) {
    return <ReActOutputPackage payload={trace.responsePayload} />;
  }

  if (isPlanExecuteResult(trace.responsePayload)) {
    return <PlanExecuteOutputPackage payload={trace.responsePayload} />;
  }

  if (isToolCallingResponsePayload(trace.responsePayload)) {
    return <ToolCallingOutputPackage payload={trace.responsePayload} />;
  }

  const responsePayload = trace.responsePayload as {
    choices?: Array<{
      message?: {
        role?: RuntimeMessage["role"];
        content?: string | null;
        reasoning_content?: string;
      };
      [key: string]: unknown;
    }>;
    [key: string]: unknown;
  };
  const choices = responsePayload.choices ?? [];

  return (
    <section className="full-package">
      <header>
        <span>完整 LLM Response JSON</span>
        <small className="purple-hint">紫色部分是 AI 回答</small>
      </header>
      <div className="json-compose">
        {Object.entries(responsePayload)
          .filter(([key]) => key !== "choices")
          .map(([key, value], index, entries) => {
            const tone = key === "usage" ? "warm" : "neutral";
            const label = key === "usage" ? "token usage" : "response metadata";
            const prefix = index === 0 ? "{\n" : "";

            return (
              <AnnotatedJsonBlock key={key} tone={tone} label={label}>
                {`${prefix}  ${JSON.stringify(key)}: ${JSON.stringify(value, null, 2).replace(/\n/g, "\n  ")}${entries.length > 0 || choices.length > 0 ? "," : ""}\n`}
              </AnnotatedJsonBlock>
            );
          })}
        {choices.map((choice, index) => {
          const message = choice.message ?? {};
          const restChoice = Object.fromEntries(
            Object.entries(choice).filter(([key]) => key !== "message"),
          );
          const suffix = index === choices.length - 1 ? "\n" : ",\n";
          const prefix = index === 0 ? `  "choices": [\n` : "";
          const closing = index === choices.length - 1 ? `  ]\n}` : "";

          return (
            <span key={`choice-${index}`}>
              <AnnotatedJsonBlock tone="purple" label="assistant output">
                {`${prefix}    {
      "message": {
        "role": ${JSON.stringify(message.role)},
        "content": `}
                <span className="json-ai-answer">{JSON.stringify(message.content ?? null)}</span>
                {Object.prototype.hasOwnProperty.call(message, "reasoning_content")
                  ? `,
        "reasoning_content": ${JSON.stringify(message.reasoning_content)}`
                  : ""}
                {`
      }`}
                {Object.keys(restChoice).length > 0
                  ? `,
${JSON.stringify(restChoice, null, 6)
  .slice(2, -2)
  .replace(/\n/g, "\n      ")}`
                  : ""}
                {`
    }`}
                {suffix}
                {closing}
              </AnnotatedJsonBlock>
            </span>
          );
        })}
      </div>
    </section>
  );
}

function ToolCallingOutputPackage({ payload }: { payload: ToolCallingResponsePayload }) {
  return (
    <section className="full-package">
      <header>
        <span>Tool Calling 输出链路</span>
        <small className="purple-hint">tool_call → tool result → final answer</small>
      </header>
      <div className="json-compose">
        <AnnotatedJsonBlock tone="warm" label="first model response">
          {JSON.stringify(payload.initialResponsePayload, null, 2)}
        </AnnotatedJsonBlock>
        <AnnotatedJsonBlock tone="green" label="tool results">
          {JSON.stringify(payload.toolExecutions ?? [], null, 2)}
        </AnnotatedJsonBlock>
        <AnnotatedJsonBlock tone="purple" label="final model response">
          {JSON.stringify(
            payload.followUpResponsePayload ?? payload.initialResponsePayload,
            null,
            2,
          )}
        </AnnotatedJsonBlock>
      </div>
    </section>
  );
}

function ReActOutputPackage({ payload }: { payload: ReActResult }) {
  return (
    <section className="full-package">
      <header>
        <span>ReAct 输出链路</span>
        <small className="purple-hint">thought → action → observation → ... → final answer</small>
      </header>
      <div className="json-compose">
        {payload.reactSteps.map((step) => (
          <span key={`react-out-round-${step.round}`}>
            <AnnotatedJsonBlock
              tone="warm"
              label={`round ${step.round} response`}
            >
              {JSON.stringify(step.responsePayload, null, 2)}
            </AnnotatedJsonBlock>
            <AnnotatedJsonBlock
              tone="neutral"
              label={`round ${step.round} parsed`}
            >
              {JSON.stringify(step.parsed, null, 2)}
            </AnnotatedJsonBlock>
            {step.toolExecution ? (
              <AnnotatedJsonBlock
                tone="green"
                label={`round ${step.round} tool execution`}
              >
                {JSON.stringify(step.toolExecution, null, 2)}
              </AnnotatedJsonBlock>
            ) : null}
            {step.observationMessage ? (
              <AnnotatedJsonBlock
                tone="purple"
                label={`round ${step.round} observation`}
              >
                {JSON.stringify(step.observationMessage, null, 2)}
              </AnnotatedJsonBlock>
            ) : null}
          </span>
        ))}
        {payload.finalResponsePayload ? (
          <AnnotatedJsonBlock tone="purple" label="final response">
            {JSON.stringify(payload.finalResponsePayload, null, 2)}
          </AnnotatedJsonBlock>
        ) : null}
        <AnnotatedJsonBlock tone="green" label="final answer">
          {JSON.stringify(payload.finalAnswer, null, 2)}
        </AnnotatedJsonBlock>
      </div>
    </section>
  );
}

function PlanExecuteOutputPackage({ payload }: { payload: PlanExecuteResult }) {
  return (
    <section className="full-package">
      <header>
        <span>Plan-and-Execute 输出链路</span>
        <small className="purple-hint">planner → executor steps → synthesizer → final answer</small>
      </header>
      <div className="json-compose">
        <AnnotatedJsonBlock tone="warm" label="planner response (generated plan)">
          {JSON.stringify(payload.plannerResponsePayload, null, 2)}
        </AnnotatedJsonBlock>
        <AnnotatedJsonBlock tone="green" label="parsed plan">
          {JSON.stringify(payload.plan, null, 2)}
        </AnnotatedJsonBlock>
        {payload.steps.map((step) => (
          <span key={`pe-out-step-${step.step}`}>
            <AnnotatedJsonBlock
              tone="neutral"
              label={`step ${step.step} executor response`}
            >
              {JSON.stringify(step.executorResponsePayload, null, 2)}
            </AnnotatedJsonBlock>
            {step.toolExecutions.length > 0 ? (
              <AnnotatedJsonBlock
                tone="green"
                label={`step ${step.step} tool executions`}
              >
                {JSON.stringify(step.toolExecutions, null, 2)}
              </AnnotatedJsonBlock>
            ) : null}
            {step.followUpResponsePayload ? (
              <AnnotatedJsonBlock
                tone="purple"
                label={`step ${step.step} follow-up response`}
              >
                {JSON.stringify(step.followUpResponsePayload, null, 2)}
              </AnnotatedJsonBlock>
            ) : null}
            <AnnotatedJsonBlock
              tone="warm"
              label={`step ${step.step} result`}
            >
              {JSON.stringify(step.stepResult, null, 2)}
            </AnnotatedJsonBlock>
          </span>
        ))}
        <AnnotatedJsonBlock tone="purple" label="synthesizer response">
          {JSON.stringify(payload.synthesizerResponsePayload, null, 2)}
        </AnnotatedJsonBlock>
        <AnnotatedJsonBlock tone="green" label="final answer">
          {JSON.stringify(payload.finalAnswer, null, 2)}
        </AnnotatedJsonBlock>
      </div>
    </section>
  );
}

function ToolCallsPackage({ trace }: { trace: TraceRun }) {
  const reactResult = isReActResult(trace.requestPayload) ? trace.requestPayload : null;
  const planExecuteResult = isPlanExecuteResult(trace.requestPayload)
    ? trace.requestPayload
    : null;
  const requestPayload = isToolCallingRequestPayload(trace.requestPayload)
    ? trace.requestPayload
    : null;
  const responsePayload = isToolCallingResponsePayload(trace.responsePayload)
    ? trace.responsePayload
    : null;
  const firstModelMessage = (
    responsePayload?.initialResponsePayload as
      | {
          choices?: Array<{
            message?: {
              tool_calls?: RuntimeMessage["tool_calls"];
            };
          }>;
        }
      | undefined
  )?.choices?.[0]?.message;
  const toolExecutions = requestPayload?.toolExecutions ?? responsePayload?.toolExecutions ?? [];
  const toolCalls =
    firstModelMessage?.tool_calls ?? toolExecutions.map((execution) => execution.toolCall);
  const toolResultMessages = toolExecutions.map((execution) => ({
    role: "tool",
    tool_call_id: execution.toolCall.id,
    name: execution.name,
    content: execution.content,
  }));

  if (planExecuteResult) {
    return (
      <section className="full-package">
        <header>
          <span>Plan-and-Execute Tool Calls</span>
          <small>per-step tool execution detail</small>
        </header>
        <div className="json-compose">
          <AnnotatedJsonBlock tone="green" label="tool schemas">
            {JSON.stringify(planExecuteResult.toolDefinitions ?? [], null, 2)}
          </AnnotatedJsonBlock>
          {planExecuteResult.steps.map((step) => (
            <span key={`pe-tool-step-${step.step}`}>
              <AnnotatedJsonBlock
                tone="warm"
                label={`step ${step.step} — ${step.description}`}
              >
                {JSON.stringify(
                  {
                    step: step.step,
                    description: step.description,
                    toolExecutions: step.toolExecutions,
                    stepResult: step.stepResult,
                  },
                  null,
                  2,
                )}
              </AnnotatedJsonBlock>
              {step.toolExecutions.length > 0 ? (
                <AnnotatedJsonBlock
                  tone="neutral"
                  label={`step ${step.step} tool executions (${step.toolExecutions.length})`}
                >
                  {JSON.stringify(step.toolExecutions, null, 2)}
                </AnnotatedJsonBlock>
              ) : null}
            </span>
          ))}
        </div>
      </section>
    );
  }

  if (reactResult) {
    return (
      <section className="full-package">
        <header>
          <span>ReAct Tool Calls</span>
          <small>round-by-round action / execution / observation</small>
        </header>
        <div className="json-compose">
          <AnnotatedJsonBlock tone="green" label="tool schemas">
            {JSON.stringify(reactResult.toolDefinitions ?? [], null, 2)}
          </AnnotatedJsonBlock>
          {reactResult.reactSteps.map((step) => (
            <span key={`react-tool-round-${step.round}`}>
              <AnnotatedJsonBlock tone="warm" label={`round ${step.round} parsed action`}>
                {JSON.stringify(
                  {
                    action: step.parsed.action,
                    actionInput: step.parsed.actionInput,
                    thought: step.parsed.thought,
                    parseError: step.parsed.parseError,
                  },
                  null,
                  2,
                )}
              </AnnotatedJsonBlock>
              {step.toolExecution ? (
                <AnnotatedJsonBlock tone="neutral" label={`round ${step.round} execution`}>
                  {JSON.stringify(step.toolExecution, null, 2)}
                </AnnotatedJsonBlock>
              ) : null}
              {step.observationMessage ? (
                <AnnotatedJsonBlock tone="purple" label={`round ${step.round} observation`}>
                  {JSON.stringify(step.observationMessage, null, 2)}
                </AnnotatedJsonBlock>
              ) : null}
            </span>
          ))}
        </div>
      </section>
    );
  }

  if (!requestPayload && trace.mode !== "tool-calling") {
    return (
      <section className="full-package">
        <header>
          <span>Tool Calls</span>
          <small>Basic LLM trace</small>
        </header>
        <div className="empty-panel">This trace did not attach tools or execute tool calls.</div>
      </section>
    );
  }

  return (
    <section className="full-package">
      <header>
        <span>Tool Calling Detail</span>
        <small>schema / call / execution / tool message</small>
      </header>
      <div className="json-compose">
        <AnnotatedJsonBlock tone="green" label="tool schemas">
          {JSON.stringify(requestPayload?.toolDefinitions ?? [], null, 2)}
        </AnnotatedJsonBlock>
        <AnnotatedJsonBlock tone="warm" label="model tool_calls">
          {JSON.stringify(toolCalls, null, 2)}
        </AnnotatedJsonBlock>
        <AnnotatedJsonBlock tone="neutral" label="local executions">
          {JSON.stringify(toolExecutions, null, 2)}
        </AnnotatedJsonBlock>
        <AnnotatedJsonBlock tone="purple" label="role=tool messages">
          {JSON.stringify(toolResultMessages, null, 2)}
        </AnnotatedJsonBlock>
      </div>
    </section>
  );
}

function MemoryPackage({ trace }: { trace: TraceRun }) {
  return (
    <section className="full-package">
      <header>
        <span>Memory JSON</span>
        <small>下一轮会带上的对话记录</small>
      </header>
      <div className="json-compose">
        {trace.conversationMessages.map((message, index) => {
          const suffix = index === trace.conversationMessages.length - 1 ? "\n" : ",\n";
          const prefix = index === 0 ? "[\n" : "";
          const closing = index === trace.conversationMessages.length - 1 ? "]" : "";
          const label =
            message.role === "user"
              ? "saved user prompt"
              : message.role === "tool"
                ? "saved tool result"
                : message.tool_calls?.length
                  ? "saved assistant tool call"
                  : "saved assistant response";
          const tone =
            message.role === "user" ? "green" : message.role === "tool" ? "warm" : "purple";
          const messageJson = `  ${JSON.stringify(
            {
              role: message.role,
              content: message.content ?? null,
              ...(message.name ? { name: message.name } : {}),
              ...(message.tool_call_id ? { tool_call_id: message.tool_call_id } : {}),
              ...(message.tool_calls ? { tool_calls: message.tool_calls } : {}),
            },
            null,
            2,
          ).replace(/\n/g, "\n  ")}`;

          return (
            <span key={`memory-${message.id}`}>
              <AnnotatedJsonBlock tone={tone} label={label}>
                {prefix}
                {messageJson}
                {suffix}
                {closing}
              </AnnotatedJsonBlock>
            </span>
          );
        })}
      </div>
    </section>
  );
}

function RawTracePackage({ trace }: { trace: TraceRun }) {
  const traceMeta = {
    id: trace.id,
    mode: trace.mode,
    modeName: trace.modeName,
    turnNumber: trace.turnNumber,
    model: trace.model,
    temperature: trace.temperature,
    durationMs: trace.durationMs,
  };

  return (
    <section className="full-package">
      <header>
        <span>Raw Trace JSON</span>
        <small>AgentXRay 保存的整条运行记录</small>
      </header>
      <div className="json-compose">
        <AnnotatedJsonBlock tone="neutral" label="trace metadata">
          {`{
  "meta": ${JSON.stringify(traceMeta, null, 2).replace(/\n/g, "\n  ")},`}
        </AnnotatedJsonBlock>
        <AnnotatedJsonBlock tone="green" label="request payload">
          {`  "requestPayload": ${JSON.stringify(trace.requestPayload, null, 2).replace(/\n/g, "\n  ")},`}
        </AnnotatedJsonBlock>
        <AnnotatedJsonBlock tone="purple" label="llm response">
          {`  "responsePayload": ${JSON.stringify(trace.responsePayload, null, 2).replace(/\n/g, "\n  ")},`}
        </AnnotatedJsonBlock>
        <AnnotatedJsonBlock tone="warm" label="memory snapshot">
          {`  "conversationMessages": ${JSON.stringify(
            trace.conversationMessages,
            null,
            2,
          ).replace(/\n/g, "\n  ")}
}`}
        </AnnotatedJsonBlock>
      </div>
    </section>
  );
}

function AnnotatedJsonBlock({
  children,
  label,
  tone,
}: {
  children: ReactNode;
  label: string;
  tone: "green" | "purple" | "warm" | "neutral";
}) {
  return (
    <span className={`json-annotation json-annotation-${tone}`}>
      <span className="json-annotation-label">{label}</span>
      {children}
    </span>
  );
}
