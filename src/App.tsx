import { useMemo, useState } from "react";
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
  { id: "output", label: "LLM Output", icon: Inbox },
  { id: "memory", label: "Memory", icon: History },
  { id: "raw", label: "Raw", icon: Layers3 },
];

const formatJson = (value: unknown) => JSON.stringify(value, null, 2);

const roleLabel: Record<RuntimeMessage["role"], string> = {
  system: "system",
  user: "user",
  assistant: "assistant",
  tool: "tool",
};

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
    return (
      <div className="beginner-panel">
        <section className="plain-section">
          <h4>完整发送给 LLM 的一次性输入</h4>
          <p>
            远程模型不会自动记住上一次聊天。每一轮请求都必须把 system prompt、
            历史对话和本轮输入一起发过去。
          </p>
        </section>
        <div className="message-stack">
          {trace.requestMessages.map((message) => (
            <MessageBlock
              isAdded={message.role === "user" && message.content === trace.userPrompt}
              key={message.id}
              message={message}
            />
          ))}
        </div>
        <JsonBlock label="exactRequestPayload" value={trace.requestPayload} />
      </div>
    );
  }

  if (tab === "output") {
    return (
      <div className="beginner-panel">
        <section className="plain-section">
          <h4>LLM 返回的一次性输出</h4>
          <p>
            AgentXRay 把模型当作黑盒：这里只展示远程 API 返回给 Runtime 的可观察结果。
          </p>
        </section>
        <MessageBlock isAdded message={trace.assistantMessage} />
        <JsonBlock label="exactResponsePayload" value={trace.responsePayload} />
      </div>
    );
  }

  if (tab === "memory") {
    return (
      <div className="beginner-panel">
        <section className="plain-section">
          <h4>记忆是怎么来的</h4>
          <p>
            LLM 本身不保存你们刚才聊过什么。Runtime 会把历史 user / assistant
            消息保存在本地，并在下一次请求时重新放进输入包。
          </p>
        </section>
        {trace.memoryMessages.length > 0 ? (
          <div className="message-stack">
            {trace.memoryMessages.map((message) => (
              <MessageBlock
                isAdded={false}
                key={message.id}
                message={message}
              />
            ))}
          </div>
        ) : (
          <div className="empty-panel">
            这是第一轮请求，暂时没有上一轮对话可带入。问第二个问题时，这里会出现上一轮
            user / assistant 消息。
          </div>
        )}
        <JsonBlock label="savedForNextTurn" value={trace.conversationMessages} />
      </div>
    );
  }

  return <JsonBlock label="rawTraceRun" value={trace} />;
}

function MessageBlock({
  message,
  isAdded,
}: {
  message: RuntimeMessage;
  isAdded: boolean;
}) {
  return (
    <article className={`message-block role-${message.role} ${isAdded ? "is-added" : ""}`}>
      <header>
        <span className="role-badge">{roleLabel[message.role]}</span>
        <span>{message.source}</span>
        <code>{message.id}</code>
      </header>
      <pre>{formatJson(message)}</pre>
    </article>
  );
}

function JsonBlock({
  label,
  value,
  accent,
}: {
  label: string;
  value: unknown;
  accent?: "added";
}) {
  return (
    <section className={`json-block ${accent === "added" ? "is-added" : ""}`}>
      <header>{label}</header>
      <pre>{typeof value === "string" ? value : formatJson(value)}</pre>
    </section>
  );
}
