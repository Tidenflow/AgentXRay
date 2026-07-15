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
- [The Boundary AgentXRay Explains](#the-boundary-agentxray-explains)
- [Supported Agent Modes](#supported-agent-modes)
- [Try It — Example Prompts](#try-it--example-prompts)
- [Mode Comparison](#mode-comparison)
- [Architecture](#architecture)
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

**AgentXRay** turns this black box into an observable message pipeline. Across four agent modes — Basic LLM, Tool Calling, ReAct, and Plan-and-Execute — it shows exactly how each one assembles messages, calls tools, and grows its context, so you can answer:

> *"How does a model output become a runtime decision and real code execution?"*

## The Boundary AgentXRay Explains

An LLM generates tokens. The JSON visible in an agent application comes from several
different layers, and treating it all as "the model output" hides the most important part:

| Layer | Responsibility |
|---|---|
| Agent runtime | Assembles `messages`, tool schemas, and follow-up requests |
| LLM | Chooses whether to answer or request a tool, and generates its name and arguments |
| Model provider | Exposes generated content through its HTTP API and decodes native tool-call output into `message.tool_calls` |
| Agent runtime | Parses arguments, validates and routes the request, and invokes local code |
| Tool | Produces an external result; it is never executed by the model |

For example, when a user asks for current weather, a native tool-calling flow is conceptually:

```text
User: "What is the weather in Shanghai today?"
  → Runtime exposes get_weather(location)
  → A tool-trained model emits a tool-call representation
  → Provider exposes it as tool_calls(name="get_weather", arguments="{...}")
  → Runtime parses arguments and resolves get_weather in its tool registry
  → Runtime executes the function
  → Runtime appends a role=tool result
  → Model receives that result and writes the final answer
```

**The model requests; the runtime executes.** AgentXRay can observe the request sent to
the provider and the structured response returned by it. It cannot observe the provider's
internal special-token representation or decoding implementation, so that boundary is
explicitly labeled `provider-managed` rather than presented as model reasoning.

---

## Supported Agent Modes

AgentXRay implements four agent architectures, each revealing a different layer of the runtime message pipeline.

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

| Tool | Parameter | Type | Description |
|---|---|---|---|
| `calculate` | `expression` | `string` | Evaluate arithmetic — `+`, `-`, `*`, `/`, `%`, `^`, parentheses, decimals |
| `get_current_datetime` | `timezone` | `string` *(optional)* | Get current date & time for an IANA timezone (e.g. `Asia/Shanghai`, `America/New_York`) |

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

## Try It — Example Prompts

Here are prompts designed to exercise each mode so you can see the trace inspector in action.

### Basic LLM

```
What's the difference between Fahrenheit and Celsius?
```

→ **Watch:** Single request/response. Check the **Sent to LLM** tab to see how the system prompt and user message are assembled. Switch to **Memory** to see the conversation snapshot.

### Tool Calling

```
If I invest $10,000 at 7% annual return compounded yearly for 20 years, what will it be worth? Use the calculate tool for the math.
```

→ **Watch:** The model issues a `calculate` tool call with `10000 * (1 + 0.07) ^ 20`. Check the **Tool Calls** tab to see the tool schema, the model's `tool_calls` JSON, the local execution result, and the follow-up request that feeds the result back to the model.

```
What time is it in Tokyo right now? And what's the date in New York?
```

→ **Watch:** Multiple tool calls in one turn. The model may call `get_current_datetime` twice. The **Sent to LLM** tab shows how tool results become `role=tool` messages in the follow-up request.

### ReAct

```
If a train leaves Station A at 60 mph and another leaves Station B at 80 mph, 300 miles apart, when do they meet? Use the calculate tool to check your math.
```

→ **Watch:** The model writes `Thought:`, `Action: calculate`, `Action Input: {"expression": "300/(60+80)"}`. The runtime executes the tool and appends an `Observation:`. The **LLM Response** tab shows the parsed Thought/Action/Observation for each round. See how the message stack grows across rounds in **Memory**.

```
What is the date and time in Shanghai, and how many hours remain until next Friday?
```

→ **Watch:** Multi-tool ReAct loop — `get_current_datetime` then `calculate` on the result.

### Plan-and-Execute

```
Compare the population density of Tokyo, London, and New York City. For each city, include approximate population and area.
```

→ **Watch:** The **Planner** generates a step list (e.g., "1. Look up Tokyo population and area, 2. Look up London..., 3. Look up NYC..., 4. Calculate densities, 5. Compare"). Each step runs independently with its own tool calls. The **Synthesizer** merges all step results into a final comparison. Check **LLM Response** to see the planner output, each executor response, and the synthesizer's final assembly.

---

## Mode Comparison

| Dimension | Basic LLM | Tool Calling | ReAct | Plan-and-Execute |
|---|---|---|---|---|
| **Model calls per turn** | 1 | 1–2 | 2–9 | 2 + N steps |
| **Tool execution** | No | Yes (local) | Yes (local) | Yes (per step) |
| **Message growth** | +2 / turn | +2–5 / turn | +3 per round | +2 per step |
| **Best for inspecting** | Request/response shape | Tool schema & result merging | Multi-turn reasoning loops | Task decomposition pipelines |
| **Max rounds/steps** | N/A | N/A | 8 (default 4) | Unlimited |
| **Temperature configurable** | Yes | Yes | Yes | Yes |

---

## Architecture

AgentXRay runs entirely in the browser with a Vite dev-server proxy — no separate backend process.

```
┌─────────────┐     ┌─────────────────────────────┐     ┌──────────────────┐
│   Browser   │────▶│   Vite Dev Server (:5173)    │────▶│  DeepSeek API    │
│             │     │                             │     │  api.deepseek.com│
│  React App  │     │  /api/deepseek/chat          │     │                  │
│  (Trace UI) │◀────│  /api/deepseek/tool-calling  │◀────│  /v1/chat/       │
│             │     │  /api/deepseek/react          │     │   completions    │
│             │     │  /api/deepseek/plan-execute   │     │                  │
└─────────────┘     └─────────────────────────────┘     └──────────────────┘
```

### Data Flow

Each agent mode follows the same trace pipeline:

```
1. User types a prompt
         │
2. App.tsx builds mode-specific request body
   (system prompt, messages, tools, maxRounds...)
         │
3. Vite proxy forwards to DeepSeek API
   (API key injected server-side, never reaches browser)
         │
4. Proxy executes local tools (calculate, get_current_datetime)
   when the model returns tool_calls
         │
5. Proxy returns a unified result object
   (request payload, response payload, tool executions, duration)
         │
6. App.tsx trace builder constructs a TraceRun
   - Extracts memory messages (all non-system, non-current-user messages)
   - Tags each message with its source (user_input | system_prompt | model_response | tool_result | planner | executor | synthesizer)
   - Assembles color-coded conversation history
         │
7. Inspector tabs render the TraceRun
   Sent to LLM │ LLM Response │ Tool Calls │ Memory │ Raw Trace
```

### API Proxy Endpoints

| Endpoint | Method | Key Request Fields | Returns |
|---|---|---|---|
| `/api/deepseek/chat` | POST | `prompt`, `temperature` | `DeepSeekResult` — request/response payloads, model, duration |
| `/api/deepseek/tool-calling` | POST | `prompt`, `temperature` | `ToolCallingResult` — extends DeepSeekResult with `toolDefinitions`, `toolExecutions`, `followUpRequestPayload` |
| `/api/deepseek/react` | POST | `prompt`, `temperature`, `maxRounds` | `ReActResult` — `reactSteps[]` with per-round parsed Thought/Action/Observation |
| `/api/deepseek/plan-execute` | POST | `prompt`, `temperature` | `PlanExecuteResult` — `plan[]`, `steps[]` with per-step tool executions |

All endpoints share the same DeepSeek configuration from `.env`. The proxy:
- Strips `reasoning_content` from model responses (hidden reasoning is outside runtime inspection scope)
- Handles tool execution locally — no external tool server needed
- Measures and returns `durationMs` for every call

### Key Data Types

**`RuntimeMessage`** — every message in the pipeline carries a `source` tag:

```typescript
type MessageSource =
  | "user_input"       // typed by the user
  | "system_prompt"    // injected by the runtime
  | "agent_runtime"    // constructed by the agent loop
  | "model_response"   // returned by the LLM
  | "tool_result"      // produced by local tool execution
  | "planner"          // Plan-and-Execute phase 1
  | "executor"         // Plan-and-Execute phase 2
  | "synthesizer";     // Plan-and-Execute phase 3
```

**`TraceRun`** — a complete trace record:

```typescript
{
  id, mode, modeName,         // identity
  turnNumber, userPrompt,     // input
  finalAnswer, durationMs,    // output
  requestPayload,             // what was sent
  responsePayload,            // what came back
  requestMessages,            // current-turn messages
  memoryMessages,             // carried forward from previous turns
  conversationMessages,       // full conversation (memory + current + assistant)
  assistantMessage            // the model's final response
}
```

---

## How It Works

```
┌────────────────┬────────────────────────┬──────────────────────┐
│ Experiments    │ Runtime Timeline       │ Step Inspector       │
│                │                        │                      │
│ Prompt groups  │ Per-mode result tabs   │ Actor / visibility   │
│ Mode runs      │ Runtime control flow   │ Transition reason    │
│ Status/errors  │ Observed steps         │ Input / output       │
│                │                        │ Raw evidence         │
└────────────────┴────────────────────────┴──────────────────────┘
│ Experiment composer: prompt + mode selection + runtime settings │
└─────────────────────────────────────────────────────────────────┘
```

- **Experiment Sidebar** — groups runs by prompt. A single experiment can execute the same prompt sequentially across several selected agent modes; successful runs remain available even if another mode fails.
- **Runtime Timeline** — the primary view for Basic LLM and Tool Calling. It shows who acted, what happened, and why control moved to the next step instead of presenting another generic chat window.
- **Step Inspector** — explains the selected step through its actor, observability, transition reason, inputs, outputs, state changes, and raw evidence.
- **Experiment Composer** — selects one or more agent modes, edits the prompt, and configures shared runtime parameters including temperature and additional system instructions.
- **Resizable Workspace** — both vertical separators can be dragged to resize the experiment list, timeline, and inspector; double-clicking a separator restores its default width.

ReAct and Plan-and-Execute currently retain their detailed legacy views and will be mapped
to the same runtime-step language after the Tool Calling and Basic LLM flows are complete.

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

> **Coming soon.** Clone the repo and run `npm run dev` to see it live — it takes under a minute to get going.

If you'd like to contribute screenshots, see [Contributing](#contributing).

---

## Prerequisites

- **Node.js** >= 18
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
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` | API base URL — change only for a proxy or a self-hosted DeepSeek-compatible endpoint |
| `DEEPSEEK_MODEL` | `deepseek-v4-flash` | `deepseek-v4-flash` for speed, `deepseek-v4-pro` for quality |
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
| Styling | Plain CSS (warm palette, three-column CSS Grid, min-width 1180px) |
| API Proxy | Vite dev-server middleware (`/api/deepseek/*`) |
| LLM | DeepSeek (configurable base URL & model) |

No separate backend. The Vite dev server proxies API calls so your API key never leaks to the browser.

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

> The proxy actively redacts `reasoning_content` from model responses — that's the model's private scratchpad, not part of the runtime's observable surface.

---

## Project Structure

```
.
├── index.html              # HTML entry point
├── package.json            # Dependencies & scripts
├── vite.config.ts          # Vite config + all DeepSeek API proxy middleware (1100+ lines)
│                           #   /api/deepseek/chat          — Basic LLM
│                           #   /api/deepseek/tool-calling   — Tool Calling
│                           #   /api/deepseek/react          — ReAct loop
│                           #   /api/deepseek/plan-execute   — Plan-and-Execute pipeline
├── tsconfig.json           # TypeScript config
├── .env.example            # Environment variable template
├── src/
│   ├── main.tsx            # React entry point
│   ├── App.tsx             # Main application — UI components, state, trace builders, inspector panels (1700+ lines)
│   ├── runtime/
│   │   └── traceSteps.ts   # Basic/Tool Calling traces → shared RuntimeStep timeline
│   ├── types.ts            # TypeScript type definitions (AgentModeId, RuntimeMessage, TraceRun, etc.)
│   ├── styles.css          # Resizable three-pane workbench and runtime visualization styles
│   └── data/               # Static data / default traces
└── docs/
    └── version1plan.md     # Original design document (Chinese)
```

---

## MVP Status

All four agent modes are fully implemented with real DeepSeek API calls and annotated trace visualization:

- [x] Resizable three-pane experiment workbench (Experiments / Runtime Timeline / Step Inspector)
- [x] Run the same prompt sequentially across multiple selected agent modes
- [x] Group per-mode results and partial failures under a shared experiment
- [x] **Basic LLM** — real DeepSeek request/response visualization
- [x] **Tool Calling** — provider boundary, tool schema, argument parsing, local execution, result append, second model request
- [x] **ReAct** — Action/Observation loop, multi-turn message growth, max-round limit, final answer synthesis
- [x] **Plan-and-Execute** — Planner → Executor → Synthesizer pipeline, per-step tool execution, plan-to-context flow
- [x] Annotated JSON viewers for request, response, memory, and raw trace
- [x] Runtime parameters — temperature and editable additional system instructions
- [x] In-session experiment history and per-mode result switching
- [x] Vite dev-server proxy — no separate backend needed

---

## Roadmap

AgentXRay is deliberately narrow: **one provider (DeepSeek), four agent modes, explained well.** The goal is a clear, faithful trace of each mode — not a broad multi-provider platform. Everything below is about making those four flows sharper, not adding surface area.

- [ ] **Screenshots & a short walkthrough** for each of the four modes
- [ ] **Unify the step language** — bring the ReAct and Plan-and-Execute timelines fully in line with Basic LLM and Tool Calling
- [ ] **Clearer empty & error states** in the trace inspector (parse failures, unknown tools, round-limit fallback)
- [ ] **Copy-to-clipboard** for any payload panel

Intentionally **out of scope**, to keep the four core flows easy to follow: multi-provider adapters, streaming, dark mode, trace export/diff, and UI-defined tools. DeepSeek speaks the OpenAI-compatible protocol, so pointing `DEEPSEEK_BASE_URL` at another compatible endpoint already works for experimentation — but the project isn't trying to be a provider-agnostic tool.

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
