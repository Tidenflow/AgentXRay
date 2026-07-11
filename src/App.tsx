import { type ReactNode, useMemo, useState } from "react";
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
import type { AgentModeId, RuntimeMessage, ToolExecution, TraceRun } from "./types";

type InspectorTab = "input" | "output" | "tools" | "memory" | "raw";

type AgentModeOption = {
  id: AgentModeId;
  name: string;
  description: string;
  enabled: boolean;
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
    description: "等待真实 Action / Observation parser 接入后启用。",
    enabled: false,
  },
  {
    id: "plan-execute",
    name: "Plan-and-Execute",
    description: "等待真实 planner / executor / synthesizer 接入后启用。",
    enabled: false,
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

export function App() {
  const [activeMode, setActiveMode] = useState<AgentModeId>("basic");
  const [prompt, setPrompt] = useState("");
  const [conversationMessages, setConversationMessages] = useState<RuntimeMessage[]>([]);
  const [traces, setTraces] = useState<TraceRun[]>([]);
  const [activeTraceId, setActiveTraceId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<InspectorTab>("input");
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeTrace = useMemo(
    () => traces.find((trace) => trace.id === activeTraceId) ?? null,
    [activeTraceId, traces],
  );

  const selectTrace = (trace: TraceRun) => {
    setActiveTraceId(trace.id);
    setActiveTab("input");
    setActiveMode(trace.mode);
    setPrompt(trace.userPrompt);
    setConversationMessages(trace.conversationMessages);
  };

  const runTrace = async () => {
    const cleanPrompt = prompt.trim();
    if (!cleanPrompt || isRunning) return;

    setIsRunning(true);
    setError(null);

    try {
      const turnNumber =
        conversationMessages.filter((message) => message.role === "user").length + 1;
      const userMessage = toRuntimeMessage(`turn-${turnNumber}-user`, "user", cleanPrompt);
      const systemMessage =
        activeMode === "tool-calling" ? toolCallingSystemPromptMessage() : systemPromptMessage();
      const requestMessages = [systemMessage, ...conversationMessages, userMessage];
      const endpoint =
        activeMode === "tool-calling" ? "/api/deepseek/tool-calling" : "/api/deepseek/chat";
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: requestMessages.map(toApiMessage) }),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error ?? "DeepSeek request failed.");
      }

      const trace =
        activeMode === "tool-calling"
          ? buildTraceFromToolCalling(cleanPrompt, payload as ToolCallingResult, turnNumber)
          : buildTraceFromDeepSeek(cleanPrompt, payload as DeepSeekResult, turnNumber);
      setTraces((current) => [trace, ...current]);
      setConversationMessages(trace.conversationMessages);
      setActiveTraceId(trace.id);
      setActiveTab("input");
      setPrompt("");
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "Unknown runtime error.");
    } finally {
      setIsRunning(false);
    }
  };

  const selectedMode = modeOptions.find((mode) => mode.id === activeMode) ?? modeOptions[0];

  return (
    <main className="app-shell">
      <Sidebar
        activeMode={activeMode}
        activeTrace={activeTrace}
        modes={modeOptions}
        onNewTrace={() => {
          setActiveTraceId(null);
          setPrompt("");
          setConversationMessages([]);
          setError(null);
        }}
        onSelectMode={setActiveMode}
        onSelectTrace={selectTrace}
        traces={traces}
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
      />
      <TraceInspector
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        trace={activeTrace}
      />
    </main>
  );
}

function Sidebar({
  activeMode,
  activeTrace,
  modes,
  onNewTrace,
  onSelectMode,
  onSelectTrace,
  traces,
}: {
  activeMode: AgentModeId;
  activeTrace: TraceRun | null;
  modes: AgentModeOption[];
  onNewTrace: () => void;
  onSelectMode: (mode: AgentModeId) => void;
  onSelectTrace: (trace: TraceRun) => void;
  traces: TraceRun[];
}) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">
          <Activity size={18} />
        </div>
        <div>
          <h1>AgentXRay</h1>
          <p>Message Inspector</p>
        </div>
      </div>

      <button className="new-trace-button" onClick={onNewTrace}>
        <Plus size={16} />
        New Trace
      </button>

      <section className="nav-section">
        <div className="section-label">Agent Modes</div>
        <div className="mode-list">
          {modes.map((mode) => (
            <button
              className={`mode-item ${activeMode === mode.id ? "is-active" : ""}`}
              disabled={!mode.enabled}
              key={mode.id}
              onClick={() => onSelectMode(mode.id)}
            >
              <span className="mode-dot" />
              <span>
                <strong>{mode.name}</strong>
                <small>{mode.description}</small>
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="nav-section">
        <div className="section-label">Trace History</div>
        <div className="history-list">
          {traces.length === 0 ? (
            <div className="empty-list">No real traces yet.</div>
          ) : (
            traces.map((trace) => (
              <button
                className={`history-item ${activeTrace?.id === trace.id ? "is-active" : ""}`}
                key={`history-${trace.id}`}
                onClick={() => onSelectTrace(trace)}
              >
                <MessageSquareText size={15} />
                <span>{trace.userPrompt}</span>
              </button>
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
}: {
  error: string | null;
  isRunning: boolean;
  mode: AgentModeOption;
  onPromptChange: (prompt: string) => void;
  onRun: () => void;
  prompt: string;
  trace: TraceRun | null;
  visibleMessages: RuntimeMessage[];
}) {
  const chatMessages = visibleMessages.filter((message) => {
    if (message.role === "user" || message.role === "tool") return true;
    return message.role === "assistant" && (!!message.content || !!message.tool_calls?.length);
  });

  return (
    <section className="chat-pane">
      <header className="chat-header">
        <div>
          <div className="eyebrow">Current Mode</div>
          <h2>{mode.name}</h2>
        </div>
        <div className="model-pill">
          <CircleDot size={14} />
          {trace?.model ?? "deepseek-v4-pro"}
        </div>
      </header>

      <div className="chat-scroll">
        {chatMessages.length > 0 ? (
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
          <span>
            {mode.enabled
              ? trace
                ? "next run will include this conversation"
                : "real DeepSeek request"
              : "mode not wired yet"}
          </span>
          <button aria-label="Settings">
            <Settings2 size={15} />
          </button>
        </div>
        {error ? (
          <div className="error-banner">
            <AlertCircle size={15} />
            {error}
          </div>
        ) : null}
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
            disabled={isRunning || !prompt.trim() || !mode.enabled}
            onClick={onRun}
          >
            <Play size={16} />
          </button>
        </div>
      </footer>
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

function FullInputPackage({ trace }: { trace: TraceRun }) {
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

function FullOutputPackage({ trace }: { trace: TraceRun }) {
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

function ToolCallsPackage({ trace }: { trace: TraceRun }) {
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
