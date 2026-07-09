# AgentXRay

> 一个用于观察 LLM Agent Runtime 内部消息流转过程的可视化实验平台。

AgentXRay 不是一个普通的 AI 聊天机器人，也不是一个简单的 API 套壳项目。
它的目标是把一次用户输入从「点击发送」到「模型最终回复」之间，Agent Runtime 内部发生的消息构造、Prompt 拼接、工具调用、上下文回填等过程尽可能可视化展示出来。

普通 AI Chat 产品通常只展示：

```text
User Prompt → Assistant Answer
```

而 AgentXRay 希望展示：

```text
User Prompt
→ role=user message
→ system prompt injection
→ messages stack build
→ tool schema attach
→ model request payload
→ assistant response
→ tool call
→ tool execution
→ role=tool message append
→ second model request
→ final assistant message
```

本项目关注的不是“Agent 最终答得有多好”，而是：

```text
Agent 到底往模型那里发送了什么？
模型到底返回了什么？
Runtime 又把这些返回结果如何组织成下一轮上下文？
```

---

## 1. 项目核心定位

AgentXRay 的核心定位是：

```text
Agent Runtime Message Inspector
```

或者说：

```text
Agent 运行时消息栈透视器
```

它更像是 Agent 世界里的 DevTools，而不是一个聊天应用。

如果说浏览器 DevTools 可以观察：

```text
DOM 结构
Network 请求
Request Headers
Response Body
JavaScript 执行
性能信息
```

那么 AgentXRay 希望观察：

```text
messages 数组
role 分配
system prompt 注入
user prompt 包装
tool schema 附加
model request payload
assistant message
tool_calls
tool result
context append
second request
final answer
```

本项目希望让开发者真正“看见”Agent，而不是只和 Agent 聊天。

---

## 2. 项目目标

AgentXRay 的第一阶段目标是实现一个「Chat + Inspector」双视图界面。

用户在中间像普通 AI Chat 一样输入 prompt，右侧实时展示这次请求背后的 Agent Runtime 处理过程。

例如用户输入：

```text
你好
```

界面不应该只显示：

```text
Assistant: 你好！有什么可以帮你？
```

而应该同时展示 Runtime 构造出的 messages：

```json
[
  {
    "role": "system",
    "content": "You are a helpful assistant."
  },
  {
    "role": "user",
    "content": "你好"
  },
  {
    "role": "assistant",
    "content": "你好！有什么可以帮你？"
  }
]
```

并且能够逐步展示：

```text
Step 1: 用户输入被包装为 role=user message
Step 2: Runtime 注入 system prompt
Step 3: Runtime 构造 model request payload
Step 4: 模型返回 role=assistant message
Step 5: assistant message 被追加进 messages stack
```

---

## 3. 非目标

本项目不是：

```text
普通聊天机器人
OpenAI API 套壳页面
LangChain / LlamaIndex 的简单 Demo
模型效果排行榜
Token 消耗统计仪表盘
提示词管理平台
模型内部神经网络解释器
隐藏推理链展示工具
```

需要明确边界：

AgentXRay 可视化的是 Agent Runtime 层面的外部执行过程，例如 messages 构造、工具调用、上下文回填等。

本项目不宣称展示模型真实的隐藏思维过程，也不试图还原模型内部神经网络的真实决策路径。

---

## 4. 初版支持的 Agent 模式

初版计划支持四种模式：

```text
Basic LLM
Tool Calling
ReAct
Plan-and-Execute
```

这四种模式覆盖了从普通 LLM 调用到工具调用、循环式 Agent、规划式 Agent 的主要差异。

第一版不追求模式数量多，而是追求把每一种模式下的 messages 变化展示清楚。

---

# 5. Agent 模式设计

## 5.1 Basic LLM

Basic LLM 是最基础的对照模式。

它的流程是：

```text
User Input
→ System Prompt Injection
→ Messages Build
→ Model Request
→ Assistant Response
→ Context Append
```

示例输入：

```text
你好
```

Runtime 首先包装用户输入：

```json
{
  "role": "user",
  "content": "你好"
}
```

然后注入 system prompt：

```json
{
  "role": "system",
  "content": "You are a helpful assistant."
}
```

最终发送给模型的 request payload：

```json
{
  "model": "selected-model",
  "messages": [
    {
      "role": "system",
      "content": "You are a helpful assistant."
    },
    {
      "role": "user",
      "content": "你好"
    }
  ]
}
```

模型返回：

```json
{
  "role": "assistant",
  "content": "你好！有什么可以帮你？"
}
```

最终 messages stack：

```json
[
  {
    "role": "system",
    "content": "You are a helpful assistant."
  },
  {
    "role": "user",
    "content": "你好"
  },
  {
    "role": "assistant",
    "content": "你好！有什么可以帮你？"
  }
]
```

Basic LLM 模式重点展示：

```text
用户输入如何变成 role=user
system prompt 如何被注入
messages 数组如何构造
model request payload 长什么样
assistant message 如何被追加到上下文
```

---

## 5.2 Tool Calling

Tool Calling 模式用于展示模型如何通过结构化输出请求工具，以及 Runtime 如何真正执行工具。

需要强调：

```text
模型本身不会执行工具
模型只是返回 tool_call
真正执行工具的是 Agent Runtime
```

示例输入：

```text
帮我计算 128 * 64
```

Runtime 构造用户消息：

```json
{
  "role": "user",
  "content": "帮我计算 128 * 64"
}
```

Runtime 附加工具 schema：

```json
{
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "calculator",
        "description": "Evaluate a mathematical expression.",
        "parameters": {
          "type": "object",
          "properties": {
            "expression": {
              "type": "string",
              "description": "The expression to calculate."
            }
          },
          "required": ["expression"]
        }
      }
    }
  ]
}
```

第一次 model request：

```json
{
  "model": "selected-model",
  "messages": [
    {
      "role": "system",
      "content": "You can use tools when needed."
    },
    {
      "role": "user",
      "content": "帮我计算 128 * 64"
    }
  ],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "calculator",
        "description": "Evaluate a mathematical expression.",
        "parameters": {}
      }
    }
  ]
}
```

模型返回 tool call：

```json
{
  "role": "assistant",
  "content": null,
  "tool_calls": [
    {
      "id": "call_001",
      "type": "function",
      "function": {
        "name": "calculator",
        "arguments": "{\"expression\":\"128 * 64\"}"
      }
    }
  ]
}
```

Runtime 解析并执行工具：

```json
{
  "tool": "calculator",
  "arguments": {
    "expression": "128 * 64"
  },
  "result": "8192"
}
```

Runtime 将工具结果包装成 role=tool message：

```json
{
  "role": "tool",
  "tool_call_id": "call_001",
  "content": "8192"
}
```

第二次 model request 的 messages：

```json
[
  {
    "role": "system",
    "content": "You can use tools when needed."
  },
  {
    "role": "user",
    "content": "帮我计算 128 * 64"
  },
  {
    "role": "assistant",
    "content": null,
    "tool_calls": [
      {
        "id": "call_001",
        "type": "function",
        "function": {
          "name": "calculator",
          "arguments": "{\"expression\":\"128 * 64\"}"
        }
      }
    ]
  },
  {
    "role": "tool",
    "tool_call_id": "call_001",
    "content": "8192"
  }
]
```

最终模型返回：

```json
{
  "role": "assistant",
  "content": "128 * 64 = 8192。"
}
```

Tool Calling 模式重点展示：

```text
tool schema 如何被附加到请求
模型如何返回 tool_calls
Runtime 如何解析 arguments
Runtime 如何执行工具
工具结果如何被包装成 role=tool message
第二次请求的 messages 和第一次有什么不同
```

---

## 5.3 ReAct

ReAct 是 Reasoning + Acting 的组合模式。

它常见的可观察结构是：

```text
Action → Observation → Action → Observation → Final
```

在本项目中，ReAct 模式不用于展示模型真实隐藏思维链，而是用于展示一种显式的 Agent 协议：

```text
模型输出 Action
Runtime 执行 Action
Runtime 返回 Observation
模型继续基于 Observation 生成下一步
```

示例输入：

```text
帮我计算 128 * 64，并解释结果
```

Runtime 构造 ReAct system prompt：

```json
{
  "role": "system",
  "content": "You are an agent that solves tasks by alternating between Action and Observation. When a tool is needed, output an Action. When enough information is available, output Final."
}
```

用户消息：

```json
{
  "role": "user",
  "content": "帮我计算 128 * 64，并解释结果"
}
```

模型第一轮返回：

```json
{
  "role": "assistant",
  "content": "Action: calculator\nAction Input: {\"expression\":\"128 * 64\"}"
}
```

Runtime 解析 Action 并执行工具：

```json
{
  "tool": "calculator",
  "arguments": {
    "expression": "128 * 64"
  },
  "result": "8192"
}
```

Runtime 将 Observation 追加回上下文：

```json
{
  "role": "user",
  "content": "Observation: 8192"
}
```

第二轮 model request messages：

```json
[
  {
    "role": "system",
    "content": "You are an agent that solves tasks by alternating between Action and Observation..."
  },
  {
    "role": "user",
    "content": "帮我计算 128 * 64，并解释结果"
  },
  {
    "role": "assistant",
    "content": "Action: calculator\nAction Input: {\"expression\":\"128 * 64\"}"
  },
  {
    "role": "user",
    "content": "Observation: 8192"
  }
]
```

模型最终返回：

```json
{
  "role": "assistant",
  "content": "Final: 128 * 64 = 8192。这个结果可以理解为 128 组、每组 64 个单位的总量。"
}
```

ReAct 模式重点展示：

```text
ReAct prompt 如何改变模型输出格式
Action 如何被 Runtime 解析
Observation 如何被追加回上下文
下一轮请求比上一轮多了什么
循环什么时候结束
```

注意：

```text
ReAct 中展示的是显式输出的 Action / Observation 协议，
不是模型真实隐藏思维链。
```

---

## 5.4 Plan-and-Execute

Plan-and-Execute 模式用于展示 Planner 和 Executor 分离的 Agent 结构。

它的核心流程是：

```text
User Input
→ Planner Request
→ Plan Generated
→ Executor Context Build
→ Execute Step
→ Step Result
→ Synthesis Request
→ Final Answer
```

示例输入：

```text
帮我计算 128 * 64，并解释它在显存估算中的意义
```

Planner 阶段 request：

```json
[
  {
    "role": "system",
    "content": "You are a planner. Break the user task into executable steps. Do not solve the task yet."
  },
  {
    "role": "user",
    "content": "帮我计算 128 * 64，并解释它在显存估算中的意义"
  }
]
```

Planner 返回计划：

```json
{
  "role": "assistant",
  "content": "{\n  \"plan\": [\n    \"计算 128 * 64 的结果\",\n    \"解释该结果作为元素数量或矩阵规模时的含义\",\n    \"结合显存估算说明它可能代表的数据量\"\n  ]\n}"
}
```

Executor 阶段 request：

```json
[
  {
    "role": "system",
    "content": "You are an executor. Execute the current plan step. Use tools if necessary."
  },
  {
    "role": "user",
    "content": "Original task: 帮我计算 128 * 64，并解释它在显存估算中的意义"
  },
  {
    "role": "assistant",
    "content": "Plan: 1. 计算 128 * 64 的结果; 2. 解释含义; 3. 结合显存估算说明"
  },
  {
    "role": "user",
    "content": "Current step: 计算 128 * 64 的结果"
  }
]
```

Executor 调用工具：

```json
{
  "role": "assistant",
  "tool_calls": [
    {
      "id": "call_001",
      "type": "function",
      "function": {
        "name": "calculator",
        "arguments": "{\"expression\":\"128 * 64\"}"
      }
    }
  ]
}
```

工具结果：

```json
{
  "role": "tool",
  "tool_call_id": "call_001",
  "content": "8192"
}
```

Step result：

```json
{
  "step": 1,
  "status": "completed",
  "result": "128 * 64 = 8192"
}
```

Synthesis 阶段 request：

```json
[
  {
    "role": "system",
    "content": "You are a synthesizer. Generate the final answer based on the original task, plan, and step results."
  },
  {
    "role": "user",
    "content": "Original task: 帮我计算 128 * 64，并解释它在显存估算中的意义"
  },
  {
    "role": "assistant",
    "content": "Plan: ..."
  },
  {
    "role": "user",
    "content": "Step results: 1. 128 * 64 = 8192; 2. ..."
  }
]
```

最终返回：

```json
{
  "role": "assistant",
  "content": "128 * 64 = 8192。在显存估算中，它可以代表元素数量、线程数量、矩阵维度乘积或某个 buffer 的 item count..."
}
```

Plan-and-Execute 模式重点展示：

```text
Planner 请求和 Executor 请求不是同一个请求
Plan 如何作为上下文传给 Executor
每个 step 如何构造自己的 messages
工具结果如何变成 step result
所有 step result 如何进入最终 synthesis prompt
```

---

# 6. UI 设计方向

## 6.1 整体风格

界面采用类似现代 AI Chat 产品的布局。

目标风格：

```text
LobeHub-like Chat UI + Agent DevTools Right Panel
```

即：

```text
左侧：模式与历史导航
中间：窄聊天区
右侧：Agent Runtime Inspector
```

整体布局：

```text
┌─────────────────────────────────────────────────────────────┐
│ Sidebar      │ Chat Pane                    │ Trace Inspector │
│              │                              │                 │
│ Agent Modes  │ User / Assistant Messages    │ Timeline        │
│ Trace History│ Prompt Input                 │ Messages        │
│              │                              │ Payload         │
│              │                              │ Diff            │
└─────────────────────────────────────────────────────────────┘
```

推荐宽度：

```text
Sidebar: 240px ~ 280px
Chat Pane: 560px ~ 720px
Trace Inspector: 520px ~ 680px
```

---

## 6.2 左侧 Sidebar

左侧用于：

```text
新建 Trace
选择 Agent 模式
查看历史运行记录
切换示例任务
```

初版内容：

```text
AgentXRay
────────────────
New Trace

Agent Modes
- Basic LLM
- Tool Calling
- ReAct
- Plan-and-Execute

Trace History
- 你好
- 计算 128 * 64
- 东京穿衣建议
```

---

## 6.3 中间 Chat Pane

中间区域保持类似普通 Chat 产品的体验。

它只展示：

```text
用户输入
模型最终回复
当前 Agent 模式
输入框
发送按钮
```

示例：

```text
Basic LLM

You
你好

Assistant
你好！有什么可以帮你？

[ 输入 prompt... ] [ Send ]
```

Chat Pane 不应该承担太多底层细节。

设计原则：

```text
中间负责聊天体验
右侧负责过程透视
```

---

## 6.4 右侧 Trace Inspector

右侧是项目核心。

右侧面板用于展示：

```text
当前步骤
messages stack
request payload
response payload
tool call
tool result
before / after diff
raw trace json
```

建议右侧顶部使用 Tab：

```text
Timeline | Messages | Payload | Diff | Tools | Raw
```

初版最重要的三个视图：

```text
Timeline
Messages
Diff
```

---

## 6.5 Timeline 视图

Timeline 展示 Agent Runtime 的执行步骤。

Basic LLM 示例：

```text
Step 1  User Wrapped
用户输入被包装为 role=user message

Step 2  System Injected
Runtime 注入 system prompt

Step 3  Messages Built
构造 messages 数组

Step 4  Model Request Sent
发送请求到模型

Step 5  Assistant Received
收到 role=assistant message

Step 6  Context Appended
assistant message 被追加到上下文
```

Tool Calling 示例：

```text
Step 1  User Wrapped
Step 2  Tools Attached
Step 3  Model Request Sent
Step 4  Tool Call Received
Step 5  Tool Executed
Step 6  Tool Message Appended
Step 7  Second Model Request
Step 8  Final Assistant Received
```

---

## 6.6 Messages 视图

Messages 视图展示当前步骤下完整的 messages stack。

要求：

```text
按照 role 分块展示
不同 role 使用不同标签
新增 message 需要高亮
支持展开 / 折叠 content
支持查看 raw JSON
```

示例：

```json
[
  {
    "role": "system",
    "content": "You are a helpful assistant."
  },
  {
    "role": "user",
    "content": "你好"
  },
  {
    "role": "assistant",
    "content": "你好！有什么可以帮你？"
  }
]
```

---

## 6.7 Diff 视图

Diff 视图展示某一步执行前后 messages 的变化。

例如 tool result append：

Before:

```json
[
  {
    "role": "system",
    "content": "You can use tools when needed."
  },
  {
    "role": "user",
    "content": "帮我计算 128 * 64"
  },
  {
    "role": "assistant",
    "tool_calls": [
      {
        "id": "call_001",
        "function": {
          "name": "calculator",
          "arguments": "{\"expression\":\"128 * 64\"}"
        }
      }
    ]
  }
]
```

After:

```json
[
  {
    "role": "system",
    "content": "You can use tools when needed."
  },
  {
    "role": "user",
    "content": "帮我计算 128 * 64"
  },
  {
    "role": "assistant",
    "tool_calls": [
      {
        "id": "call_001",
        "function": {
          "name": "calculator",
          "arguments": "{\"expression\":\"128 * 64\"}"
        }
      }
    ]
  },
  {
    "role": "tool",
    "tool_call_id": "call_001",
    "content": "8192"
  }
]
```

Diff 结果：

```diff
+ {
+   "role": "tool",
+   "tool_call_id": "call_001",
+   "content": "8192"
+ }
```

Diff 是本项目的核心能力之一。

---

# 7. 核心数据结构设计

## 7.1 RuntimeMessage

```ts
type MessageRole = "system" | "user" | "assistant" | "tool";

type RuntimeMessage = {
  id: string;
  role: MessageRole;
  content?: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
  source:
    | "user_input"
    | "system_prompt"
    | "agent_runtime"
    | "model_response"
    | "tool_result"
    | "planner"
    | "executor"
    | "synthesizer";
};
```

---

## 7.2 TraceStep

```ts
type TraceStepType =
  | "user_wrapped"
  | "system_injected"
  | "tools_attached"
  | "messages_built"
  | "model_request_sent"
  | "model_message_received"
  | "tool_call_detected"
  | "tool_executed"
  | "tool_message_appended"
  | "plan_generated"
  | "executor_context_built"
  | "step_result_recorded"
  | "synthesis_context_built"
  | "final_message_received"
  | "error";

type TraceStep = {
  id: string;
  mode: "basic" | "tool-calling" | "react" | "plan-execute";
  type: TraceStepType;
  title: string;
  explanation: string;

  beforeMessages: RuntimeMessage[];
  afterMessages: RuntimeMessage[];

  addedMessages?: RuntimeMessage[];
  removedMessages?: RuntimeMessage[];
  changedMessages?: RuntimeMessage[];

  requestPayload?: unknown;
  responsePayload?: unknown;

  visibleRuntimeNote?: string;

  status: "pending" | "running" | "success" | "error";
  timestamp: number;
  durationMs?: number;
};
```

---

## 7.3 AgentMode 接口

每一种 Agent 模式都应该实现统一接口。

```ts
type AgentModeId =
  | "basic"
  | "tool-calling"
  | "react"
  | "plan-execute";

type AgentInput = {
  userPrompt: string;
  systemPrompt?: string;
  tools?: ToolDefinition[];
  modelConfig?: ModelConfig;
};

interface AgentMode {
  id: AgentModeId;
  name: string;
  description: string;
  run(input: AgentInput): AsyncGenerator<TraceStep>;
}
```

所有 Agent 模式不直接操作 UI，只负责持续产出 TraceStep。

前端根据 TraceStep 统一渲染 Timeline、Messages、Payload、Diff 和 Raw JSON。

---

# 8. 建议目录结构

```text
AgentXRay/
├── README.md
├── package.json
├── apps/
│   └── web/
│       ├── src/
│       │   ├── app/
│       │   ├── components/
│       │   │   ├── layout/
│       │   │   │   ├── Sidebar.tsx
│       │   │   │   ├── ChatPane.tsx
│       │   │   │   └── TraceInspector.tsx
│       │   │   ├── chat/
│       │   │   │   ├── ChatMessage.tsx
│       │   │   │   └── PromptInput.tsx
│       │   │   ├── trace/
│       │   │   │   ├── TraceTimeline.tsx
│       │   │   │   ├── MessagesViewer.tsx
│       │   │   │   ├── PayloadViewer.tsx
│       │   │   │   ├── DiffViewer.tsx
│       │   │   │   └── RawTraceViewer.tsx
│       │   │   └── modes/
│       │   │       └── AgentModeTabs.tsx
│       │   ├── agent-modes/
│       │   │   ├── basic-llm.ts
│       │   │   ├── tool-calling.ts
│       │   │   ├── react-agent.ts
│       │   │   └── plan-execute.ts
│       │   ├── trace/
│       │   │   ├── trace-step.ts
│       │   │   ├── trace-recorder.ts
│       │   │   ├── trace-store.ts
│       │   │   └── trace-diff.ts
│       │   ├── tools/
│       │   │   ├── calculator.ts
│       │   │   ├── weather-mock.ts
│       │   │   ├── search-mock.ts
│       │   │   └── tool-registry.ts
│       │   ├── model/
│       │   │   ├── model-client.ts
│       │   │   └── message-types.ts
│       │   └── examples/
│       │       ├── basic-demo.ts
│       │       ├── tool-calling-demo.ts
│       │       ├── react-demo.ts
│       │       └── plan-execute-demo.ts
│       └── public/
└── docs/
    ├── vision.md
    ├── ui-design.md
    ├── runtime-design.md
    └── agent-modes.md
```

如果初期不做 monorepo，也可以直接简化成：

```text
src/
├── components/
├── agent-modes/
├── trace/
├── tools/
├── model/
└── examples/
```

---

# 9. 初版开发路线

## Phase 1: Static Trace Demo

目标：先不接真实模型，用 mock trace 跑通 UI。

任务：

```text
实现三栏布局
实现 Agent Mode Tabs
实现 Chat Pane
实现 Trace Timeline
实现 Messages Viewer
实现 Diff Viewer
为四种模式准备 mock trace
点击 timeline step 时更新右侧详情
```

完成标准：

```text
用户可以切换 Basic / Tool Calling / ReAct / Plan-and-Execute
每种模式都有对应的 messages stack 变化
点击每一步能看到 before / after messages
Diff 能展示新增 message
```

---

## Phase 2: Real Basic LLM

目标：Basic LLM 模式接入真实模型。

任务：

```text
实现 model client
实现 messages builder
记录 user_wrapped
记录 system_injected
记录 model_request_sent
记录 model_message_received
记录 final_message_received
```

完成标准：

```text
用户输入任意 prompt
Basic LLM 模式真实返回 assistant answer
右侧可以看到真实 request payload 和 response payload
```

---

## Phase 3: Real Tool Calling

目标：实现真实工具调用闭环。

任务：

```text
实现 tool registry
实现 calculator tool
实现 weather_mock tool
实现 tool schema builder
实现 tool_call parser
实现 tool executor
实现 tool message append
实现 second model request
```

完成标准：

```text
用户输入需要计算的问题
模型返回 tool_call
Runtime 执行工具
工具结果被包装成 role=tool message
第二次请求基于新的 messages 生成最终答案
```

---

## Phase 4: ReAct

目标：实现显式 Action / Observation 循环。

任务：

```text
编写 ReAct system prompt
约束模型输出 Action / Final
解析 Action
执行工具
追加 Observation
记录每一轮 before / after messages
设置最大轮数限制
```

完成标准：

```text
ReAct Tab 能展示至少一轮 Action → Observation → Final
每轮 messages 增长过程可见
```

---

## Phase 5: Plan-and-Execute

目标：实现 Planner / Executor / Synthesizer 分离。

任务：

```text
实现 planner prompt
生成 plan
构造 executor context
执行每个 step
记录 step result
构造 synthesis context
生成 final answer
```

完成标准：

```text
Plan-and-Execute Tab 能展示 planner request
能展示 plan 如何进入 executor context
能展示 step result 如何进入 synthesis request
```

---

# 10. 初版示例任务

建议内置几个示例任务用于展示不同 Agent 模式。

## Case 1: Basic LLM

```text
你好
```

展示重点：

```text
user prompt → role=user message
system prompt injection
assistant message append
```

---

## Case 2: Tool Calling

```text
帮我计算 128 * 64
```

展示重点：

```text
tools schema attach
assistant tool_calls
tool execution
role=tool message append
second model request
```

---

## Case 3: ReAct

```text
帮我计算 128 * 64，并解释结果
```

展示重点：

```text
Action
Action Input
Observation
next request messages
Final
```

---

## Case 4: Plan-and-Execute

```text
帮我计算 128 * 64，并解释它在显存估算中的意义
```

展示重点：

```text
planner messages
plan generated
executor context
step result
synthesis context
final answer
```

---

# 11. 项目设计原则

## 11.1 Messages First

本项目的核心不是统计数据，而是 messages stack。

优先展示：

```text
当前步骤 messages 长什么样
相比上一步新增了什么 message
当前 request payload 是什么
模型返回的 message 是什么
Runtime 又追加了什么
```

---

## 11.2 Runtime Observable

所有 Agent 模式都应该通过 TraceStep 暴露内部过程。

Agent Runtime 中任何关键动作都应该被记录：

```text
wrap user input
inject system prompt
attach tools
send model request
receive assistant message
detect tool call
execute tool
append tool message
build next request
receive final answer
```

---

## 11.3 UI Should Feel Like Chat, Not Dashboard

界面应该保持现代 AI Chat 产品的体验。

```text
中间是聊天
右边是过程
```

不要一开始做成复杂仪表盘。

---

## 11.4 Avoid False Claims

不要声称本项目展示了模型真实隐藏思维过程。

应该表述为：

```text
本项目展示 Agent Runtime 可观察到的消息流和协议层中间结果。
```

---

# 12. 后续可能扩展

初版完成后，可以继续扩展：

```text
RAG Agent
Reflection Agent
Multi-Agent
Human-in-the-loop
Guardrail
Trace Replay
Trace Export
Prompt Diff
Tool Schema Editor
Message Stack Search
Local Model Support
LangChain Adapter
OpenAI Agents SDK Adapter
```

但这些不是第一阶段重点。

第一阶段只需要把四种基础模式的 messages 变化讲清楚。

---

# 13. 一句话总结

AgentXRay 是一个用于观察 LLM Agent Runtime 内部消息流转过程的可视化实验平台。

它的核心目标是让开发者看到：

```text
我输入的 prompt 被如何包装成 role=user；
system prompt 如何被注入；
工具 schema 如何被附加；
模型返回的 tool_call 如何被 Runtime 解析；
工具结果如何被包装成 role=tool；
messages stack 如何一轮轮增长；
最终答案如何基于上下文生成。
```

本项目希望把 Agent 从黑盒变成可观察的消息流水线。
