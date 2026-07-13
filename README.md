# AgentXRay

> A visual runtime inspector for LLM agents — see every message, every payload, every turn.

<p align="center">
  <a href="https://github.com/Tidenflow/AgentXRay">
    <img alt="React" src="https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=white" />
  </a>
  <a href="https://github.com/Tidenflow/AgentXRay">
    <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5.x-3178C6?style=for-the-badge&logo=typescript&logoColor=white" />
  </a>
  <a href="https://github.com/Tidenflow/AgentXRay">
    <img alt="Vite" src="https://img.shields.io/badge/Vite-6-646CFF?style=for-the-badge&logo=vite&logoColor=white" />
  </a>
  <a href="https://github.com/Tidenflow/AgentXRay">
    <img alt="DeepSeek" src="https://img.shields.io/badge/LLM-DeepSeek-4B6BFB?style=for-the-badge&logo=openai&logoColor=white" />
  </a>
  <a href="./LICENSE">
    <img alt="License" src="https://img.shields.io/badge/License-MIT-476B54?style=for-the-badge&logo=bookstack&logoColor=white" />
  </a>
</p>

---

## Table of Contents

- [Why AgentXRay](#why-agentxray)
- [Supported Agent Modes](#supported-agent-modes)
  - [1. Basic LLM](#1-basic-llm)
  - [2. Tool Calling](#2-tool-calling)
  - [3. ReAct (Reasoning + Acting)](#3-react-reasoning--acting)
  - [4. Plan-and-Execute](#4-plan-and-execute)
- [How It Works](#how-it-works)
- [Screenshots](#screenshots)
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Tech Stack](#tech-stack)
- [Design Principles](#design-principles)
- [Project Structure](#project-structure)
- [MVP Status](#mvp-status)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [Acknowledgments](#acknowledgments)
- [License](#license)

---

## Why AgentXRay

Most AI chat products only show:

```
User Prompt → Assistant Answer
```

But inside a real Agent Runtime, *much* more happens:

```
User Prompt
→ role=user message
→ system prompt injection
→ messages stack assembly
→ tool schema attachment
→ model request payload
→ assistant response
→ tool_call parsing
→ tool execution
→ role=tool message append
→ second model request
→ final assistant answer
```

**AgentXRay** turns this black box into an observable message pipeline. Whether you're debugging why your agent hallucinated a tool call, tracing how context accumulates across ReAct rounds, or just curious what a Plan-and-Execute planner actually generates — AgentXRay gives you the X-ray vision to answer:

> *"What exactly did the Agent send to the model — and what did it get back?"*

---

## Supported Agent Modes

AgentXRay implements four agent architectures, each revealing a different layer of the runtime message pipeline:

### 1. Basic LLM

Single-turn chat completion. The simplest mode — one request, one response.

```
User Prompt → System Prompt → Messages Build → Model Request → Assistant Response
```

**Inspector reveals:** the complete request payload (model, temperature, messages array with color-coded roles), the full response payload, and the conversation memory carried into the next turn.

### 2. Tool Calling

The model decides whether to call a tool, then synthesizes tool results into a final answer.

```
User Prompt
→ System Prompt (with tool awareness)
→ First Model Request (tools attached)
→ Assistant Response (tool_calls)
→ Local Tool Execution (calculate / get_current_datetime)
→ role=tool Messages Append
→ Second Model Request (with tool results)
→ Final Assistant Answer
```

**Inspector reveals:** tool schema attachment, the `tool_calls` in the model response, local execution results, role=tool message construction, and the follow-up request that merges tool results back into context.

**Available tools:**

| Tool | Description |
|---|---|
| `calculate` | Evaluate arithmetic expressions (`+`, `-`, `*`, `/`, `%`, `^`, parentheses) |
| `get_current_datetime` | Get current date/time for any IANA timezone |

### 3. ReAct (Reasoning + Acting)

Multi-turn action/observation loop. The model reasons step-by-step, calls tools, observes results, and decides when to produce a final answer.

```
User Prompt
→ System Prompt (ReAct format instructions)
→ Round 1: Thought → Action → Action Input
→ Tool Execution
→ Observation appended to messages
→ Round 2: Thought → Action → Action Input (or Final Answer)
→ ... up to max rounds (default 4, max 8)
→ Final Answer
```

**Inspector reveals:** each round's Thought/Action/Action Input parsing, per-round request/response payloads, tool execution results, observation message construction, and the growing messages stack across rounds.

### 4. Plan-and-Execute

Three-phase pipeline: Planner decomposes the task, Executor runs each step, Synthesizer combines results into a final answer.

```
User Prompt
→ Phase 1 (Planner):  Task → Plan JSON (ordered step list)
→ Phase 2 (Executor): For each step → Tool-aware model call → Tool execution → Step result
→ Phase 3 (Synthesizer): Task + Plan + All step results → Final answer
```

**Inspector reveals:** the planner's generated plan, each executor step's independent request/response (with its own tool calls), and the synthesizer's assembly of step results into a coherent final answer.

---

## How It Works

```
┌───────────────┬──────────────────────┬─────────────────────┐
│   Sidebar     │      Chat Pane       │   Trace Inspector   │
│               │                      │                     │
│  Agent Modes  │  User / Assistant    │  Sent to LLM        │
│  New Trace    │  messages            │  LLM Response       │
│  History      │  Prompt input        │  Memory             │
│               │                      │  Raw Trace          │
└───────────────┴──────────────────────┴─────────────────────┘
```

- **Chat Pane** — the normal chat experience. Type a prompt, get a reply. Mode-specific rendering shows ReAct rounds and Plan-and-Execute phases inline.
- **Trace Inspector** — the X-ray. Four annotated JSON views reveal exactly what the runtime constructed, sent, received, and remembered.
- **Sidebar** — switch between agent modes, start fresh traces, and browse trace history with replay.

### Inspector Tabs

| Tab | Shows |
|---|---|
| **Sent to LLM** | Full request payload — model, temperature, and the complete `messages` array. Mode-specific views for tool schemas, ReAct rounds, and Plan-and-Execute phases. |
| **LLM Response** | Full response payload — assistant output highlighted, token usage, metadata. ReAct shows per-round parsed Thought/Action/Observation; Plan-and-Execute shows planner/executor/synthesizer responses. |
| **Tool Calls** | Tool schema definitions, model `tool_calls`, local execution results, and role=tool messages. Round-by-round (ReAct) or step-by-step (Plan-and-Execute) breakdowns. |
| **Memory** | The conversation snapshot that carries into the next turn — color-coded by message role and source. |
| **Raw Trace** | The entire AgentXRay trace record — metadata + request + response + memory — as a single annotated JSON document. |

---

## Screenshots

> **Coming soon.** We're working on screenshots and a demo video. In the meantime, clone the repo and run `npm run dev` to see it live — it takes under a minute to get going.

If you'd like to contribute screenshots, see [Contributing](#contributing).

---

## Prerequisites

- **Node.js** >= 18 (or latest LTS)
- **DeepSeek API key** — get one at [platform.deepseek.com](https://platform.deepseek.com)

---

## Quick Start

### 1. Clone and install

```bash
git clone https://github.com/Tidenflow/AgentXRay.git
cd AgentXRay
npm install
```

### 2. Set your API key

```bash
cp .env.example .env
```

Edit `.env` and fill in your DeepSeek API key:

```env
DEEPSEEK_API_KEY=sk-your-deepseek-api-key
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-v4-flash
DEEPSEEK_TEMPERATURE=0.7
```

### 3. Run the dev server

```bash
npm run dev
```

Open `http://localhost:5173`, select an agent mode, type a prompt, and watch the trace inspector light up.

### 4. (Optional) Build for production

```bash
npm run build
npm run preview
```

---

## Configuration

All configuration lives in `.env` (copy from `.env.example`):

| Variable | Default | Description |
|---|---|---|
| `DEEPSEEK_API_KEY` | *(required)* | Your DeepSeek API key |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` | API base URL — change for proxies or compatible providers |
| `DEEPSEEK_MODEL` | `deepseek-v4-flash` | Model to use. `deepseek-v4-flash` for speed, `deepseek-v4-pro` for quality |
| `DEEPSEEK_TEMPERATURE` | `0.7` | Sampling temperature (0.0–2.0) |

The Vite dev server proxies all `/api/deepseek/*` calls server-side, so your API key never reaches the browser.

---

## Tech Stack

| Layer | Choice |
|---|---|
| Frontend | React 19 + TypeScript |
| Build | Vite 6 |
| State | Zustand (trace history persistence) + React `useState` (component-local) |
| Icons | Lucide React |
| Styling | Plain CSS (warm palette, three-column CSS Grid) |
| API Proxy | Vite dev-server middleware (`/api/deepseek/*`) |
| LLM | DeepSeek (configurable base URL & model) |

No separate backend. The Vite dev server proxies API calls so you never leak your key to the browser.

---

## Design Principles

### Messages First

The central question is not *"Which agent is faster?"* — it's:

> *"What exactly happened to the messages?"*

Every view in AgentXRay answers one slice of that question:
- **Sent to LLM** → what went *in*
- **LLM Response** → what came *back*
- **Memory** → what will be carried *forward*
- **Raw Trace** → the complete *record*

### Observable, Not Speculative

AgentXRay visualizes what the runtime *actually constructs and sends*. It does **not** attempt to reveal the model's internal chain-of-thought, neural activations, or private reasoning. The boundary is:

```
Prompt assembly ✅
Messages stack  ✅
Tool calls      ✅
Tool results    ✅
Context append  ✅
Request/response payload ✅

Hidden reasoning ❌ (outside runtime inspection scope)
```

---

## Project Structure

```
.
├── index.html              # HTML entry point
├── package.json            # Dependencies & scripts
├── vite.config.ts          # Vite config + all DeepSeek API proxy middleware
│                           #   /api/deepseek/chat          — Basic LLM
│                           #   /api/deepseek/tool-calling   — Tool Calling
│                           #   /api/deepseek/react          — ReAct loop
│                           #   /api/deepseek/plan-execute   — Plan-and-Execute pipeline
├── tsconfig.json           # TypeScript config
├── .env.example            # Environment variable template
├── src/
│   ├── main.tsx            # React entry point
│   ├── App.tsx             # Main application — components, state, trace builders, inspector panels
│   ├── types.ts            # TypeScript type definitions (AgentModeId, RuntimeMessage, TraceRun, etc.)
│   ├── styles.css          # Complete stylesheet (three-column layout, warm palette)
│   └── data/               # Static data / default traces
└── docs/
    └── version1plan.md     # Original design document (Chinese)
```

---

## MVP Status

All four agent modes are fully implemented with real DeepSeek API calls and annotated trace visualization:

- [x] Three-column UI (Sidebar / Chat / Inspector)
- [x] **Basic LLM** — real DeepSeek request/response visualization
- [x] **Tool Calling** — tool schema builder, tool_call parser, tool executor, result append, second model request
- [x] **ReAct** — Action/Observation loop, multi-turn message growth, max-round limit, final answer synthesis
- [x] **Plan-and-Execute** — Planner → Executor → Synthesizer pipeline, per-step tool execution, plan-to-context flow
- [x] Annotated JSON viewers for request, response, memory, and raw trace
- [x] Multi-turn conversation memory
- [x] Trace history with replay
- [x] Vite dev-server proxy (no separate backend needed)

---

## Roadmap

- [ ] **Multi-provider support** — OpenAI, Anthropic, and other compatible APIs
- [ ] **Streaming visualization** — watch tokens arrive in real time in the trace inspector
- [ ] **Screenshots & demo video**
- [ ] **Dark mode**
- [ ] **Export traces** — download a trace run as JSON for sharing and debugging
- [ ] **Diff mode** — compare two trace runs side by side
- [ ] **Custom tool definitions** — let users define and register their own tools from the UI

---

## Contributing

Contributions are welcome! Here's how to get started:

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/my-feature`
3. Make your changes
4. Run the dev server and verify your changes work: `npm run dev`
5. Commit using conventional commit messages: `feat: add ...`, `fix: ...`, `docs: ...`
6. Push and open a Pull Request

For larger changes, please open an issue first to discuss what you'd like to change.

---

## Acknowledgments

AgentXRay is inspired by the need to understand what happens inside agent runtimes. The four agent modes are modeled after well-known patterns in the LLM agent literature:

- **ReAct** — Yao et al., "[ReAct: Synergizing Reasoning and Acting in Language Models](https://arxiv.org/abs/2210.03629)" (2022)
- **Plan-and-Execute** — a practical decomposition pattern widely used in agent frameworks like LangGraph, CrewAI, and AutoGPT

Built with [React](https://react.dev), [Vite](https://vitejs.dev), and [DeepSeek](https://www.deepseek.com).

---

## License

[MIT](./LICENSE)
