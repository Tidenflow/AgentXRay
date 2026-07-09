# AgentXRay

> A visual inspector for understanding how LLM Agent Runtime processes messages, prompts, tools, and context.

AgentXRay 是一个用于观察 **LLM Agent Runtime 内部消息流转过程** 的可视化实验平台。

它不是一个普通 AI 聊天机器人，而是一个类似 **Agent DevTools** 的工具：
用户在中间正常输入 prompt，右侧实时展示 Agent 在背后如何构造 messages、注入 system prompt、附加 tools schema、调用模型、处理 tool call，并将工具结果重新拼接回上下文。

---

## Why AgentXRay?

普通 AI Chat 产品通常只展示：

```text
User Prompt → Assistant Answer
```

但真实的 Agent Runtime 中会发生更多事情：

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

AgentXRay 希望把这些隐藏过程可视化，让开发者真正看见：

```text
Agent 到底往模型发送了什么？
模型到底返回了什么？
Runtime 又如何把返回结果组织成下一轮上下文？
```

---

## Core Idea

本项目的核心不是比较 token、耗时或模型效果，而是观察 Agent Runtime 的真实消息结构变化。

重点展示：

* 用户输入如何被包装成 `role=user`
* `system prompt` 如何被注入
* `messages` 数组如何构造
* `tools schema` 如何附加到请求
* 模型如何返回 `tool_calls`
* Runtime 如何解析和执行工具
* 工具结果如何被包装成 `role=tool`
* 下一轮模型请求如何基于新的上下文构造
* 最终 `assistant message` 如何生成

---

## Initial Agent Modes

初版计划支持四种 Agent 模式：

| Mode             | Description                             |
| ---------------- | --------------------------------------- |
| Basic LLM        | 最基础的普通 LLM 调用流程                         |
| Tool Calling     | 展示工具 schema、tool call、tool result 回填过程  |
| ReAct            | 展示 Action / Observation 风格的循环执行过程       |
| Plan-and-Execute | 展示 Planner、Executor、Synthesizer 分离的执行结构 |

---

## UI Design

AgentXRay 采用类似现代 AI Chat 产品的布局：

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

设计原则：

```text
中间负责聊天体验
右侧负责过程透视
```

---

## Main Views

### Timeline

展示一次 Agent Runtime 的执行步骤：

```text
User Wrapped
→ System Injected
→ Messages Built
→ Model Request Sent
→ Assistant Received
→ Context Appended
```

### Messages

展示当前步骤下完整的 `messages stack`：

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

### Diff

展示每一步执行前后 messages 的变化：

```diff
+ {
+   "role": "user",
+   "content": "你好"
+ }
```

### Payload

展示真实发送给模型的 request payload，以及模型返回的 response payload。

---

## Roadmap

### Phase 1: Real Basic LLM

* 三栏式 UI
* Agent Mode Tabs
* Chat Pane
* Trace Timeline
* Messages Viewer
* Diff Viewer
* DeepSeek API 接入
* 真实 request / response payload 展示

### Phase 2: Real Tool Calling

* Tool Registry
* Calculator Tool
* Tool Schema Builder
* Tool Call Parser
* Tool Executor
* Tool Result Message Append
* Second Model Request

### Phase 3: ReAct

* Action / Observation 循环
* 多轮 messages 增长
* 最大轮数限制
* Final Answer 生成

### Phase 4: Plan-and-Execute

* Planner
* Executor
* Step Result
* Synthesizer
* Plan 到执行上下文的流转可视化

---

## Tech Stack

Planned stack:

```text
Frontend: React / Vue + TypeScript
UI: TailwindCSS
State: Zustand / Pinia
Visualization: Timeline + JSON Viewer + Diff Viewer
Runtime: Lightweight Agent Runtime
Tools: Calculator / Weather Mock / Search Mock
Storage: Local Trace Store
```

---

## Project Principle

AgentXRay follows a **Messages First** principle.

The most important question is not:

```text
Which agent is faster?
```

but:

```text
What exactly happened to the messages?
```

---

## Boundary

AgentXRay visualizes observable Agent Runtime behavior.

It does **not** claim to reveal the model's hidden chain of thought, internal neural activations, or private reasoning process.

It focuses on:

```text
Prompt assembly
Messages stack
Tool calls
Tool results
Context append
Model request / response payload
```

---

## Summary

AgentXRay is a visual experiment platform for understanding LLM Agent Runtime.

It helps developers see how a simple prompt becomes:

```text
messages
→ model request
→ assistant response
→ tool call
→ tool result
→ updated context
→ final answer
```

The goal is to turn Agent execution from a black box into an observable message pipeline.
