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
} from "lucide-react";
import type { AgentModeId, RuntimeMessage, TraceRun } from "./types";

type InspectorTab = "input" | "output" | "memory" | "raw";

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
    messages: Array<{ role: RuntimeMessage["role"]; content: string | null }>;
  };
  responsePayload: {
    choices?: Array<{
      message?: {
        role?: RuntimeMessage["role"];
        content?: string | null;
      };
    }>;
  };
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
    description: "等待真实 tool runtime 接入后启用。",
    enabled: false,
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
): RuntimeMessage => ({
  id,
  role,
  content,
  source: sourceForRole(role),
});

const toApiMessage = (message: RuntimeMessage) => ({
  role: message.role,
  content: message.content ?? null,
});

const systemPromptMessage = (): RuntimeMessage =>
  toRuntimeMessage(
    "system-prompt",
    "system",
    "You are a helpful assistant. Respond directly to the user prompt.",
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
    setPrompt(trace.userPrompt);
    setConversationMessages(trace.conversationMessages);
  };

  const runTrace = async () => {
    const cleanPrompt = prompt.trim();
    if (!cleanPrompt || isRunning || activeMode !== "basic") return;

    setIsRunning(true);
    setError(null);

    try {
      const turnNumber =
        conversationMessages.filter((message) => message.role === "user").length + 1;
      const userMessage = toRuntimeMessage(`turn-${turnNumber}-user`, "user", cleanPrompt);
      const requestMessages = [systemPromptMessage(), ...conversationMessages, userMessage];
      const response = await fetch("/api/deepseek/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: requestMessages.map(toApiMessage) }),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error ?? "DeepSeek request failed.");
      }

      const trace = buildTraceFromDeepSeek(
        cleanPrompt,
        payload as DeepSeekResult,
        turnNumber,
      );
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
  const chatMessages = visibleMessages.filter(
    (message) => message.role === "user" || message.role === "assistant",
  );

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
                message.role === "assistant" ? "assistant-message" : "user-message"
              }`}
              key={message.id}
            >
              <div className="message-author">
                {message.role === "assistant" ? "Assistant" : "You"}
              </div>
              <p>{message.content || "No content returned."}</p>
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

  if (tab === "memory") {
    return <MemoryPackage trace={trace} />;
  }

  return <RawTracePackage trace={trace} />;
}

function FullInputPackage({ trace }: { trace: TraceRun }) {
  const payload = trace.requestPayload as {
    model?: string;
    temperature?: number;
    messages?: Array<{ role: RuntimeMessage["role"]; content: string | null }>;
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

function FullOutputPackage({ trace }: { trace: TraceRun }) {
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
            message.role === "user" ? "saved user prompt" : "saved assistant response";
          const tone = message.role === "user" ? "green" : "purple";
          const messageJson = `  ${JSON.stringify(
            {
              role: message.role,
              content: message.content ?? null,
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
