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

**AgentXRay** is a developer tool that turns the LLM Agent Runtime from a black box into an observable message pipeline.

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

AgentXRay visualizes every one of these hidden steps so you can answer:

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
│   Sidebar     │   Runtime Timeline   │   Step Inspector    │
│               │                      │                     │
│  Agent Modes  │  Runtime steps       │  Actor / visibility │
│  New Trace    │  Control flow        │  Why it happened    │
│  History      │  Prompt input        │  Input / output     │
│               │                      │  Raw evidence       │
└───────────────┴──────────────────────┴─────────────────────┘
```

- **Runtime Timeline** — the primary view for Basic LLM and Tool Calling. It shows who acted, what happened, and where control moved next instead of presenting another chat window.
- **Step Inspector** — explains the selected step through its actor, observability, transition reason, inputs, outputs, state changes, and raw evidence.
- **Sidebar** — switch between agent modes, start fresh traces, and browse trace history with replay.

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

### 3. Run

```bash
npm run dev
```

Open `http://localhost:5173`, select an agent mode, type a prompt, and watch the trace inspector light up.

---

## Tech Stack

| Layer | Choice |
|---|---|
| Frontend | React 19 + TypeScript |
| Build | Vite 6 |
| State | React `useState` (component-local) |
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
src/
├── App.tsx       # Main application — components, state, trace builders, inspector panels
├── types.ts      # TypeScript type definitions (AgentModeId, RuntimeMessage, TraceRun, etc.)
├── main.tsx      # React entry point
├── styles.css    # Complete stylesheet
docs/
├── version1plan.md   # Original design document (Chinese)
vite.config.ts    # Vite config + all DeepSeek API proxy middleware
                  #   /api/deepseek/chat          — Basic LLM
                  #   /api/deepseek/tool-calling   — Tool Calling
                  #   /api/deepseek/react          — ReAct loop
                  #   /api/deepseek/plan-execute   — Plan-and-Execute pipeline
```

---

## License

MIT
