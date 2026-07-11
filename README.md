# AgentXRay

> A visual runtime inspector for LLM agents — see every message, every payload, every turn.

[![Stack](https://img.shields.io/badge/stack-React%2019%20%2B%20TypeScript%20%2B%20Vite-blue)](https://github.com/Tidenflow/AgentXRay)
[![License](https://img.shields.io/badge/license-MIT-green)](./LICENSE)

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

> *"What exactly did the Agent send to the model — and what did it get back?"*

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

- **Chat Pane** — the normal chat experience. Type a prompt, get a reply.
- **Trace Inspector** — the X-ray. Four annotated JSON views reveal exactly what the runtime constructed, sent, received, and remembered.

### Inspector Tabs

| Tab | Shows |
|---|---|
| **Sent to LLM** | Full request payload — model, temperature, and the complete `messages` array with color-coded roles |
| **LLM Response** | Full response payload — assistant output highlighted, token usage, metadata |
| **Memory** | The conversation snapshot that carries into the next turn |
| **Raw Trace** | The entire AgentXRay trace record (meta + request + response + memory) |

---

## MVP Status

### Implemented

- [x] Three-column UI (Sidebar / Chat / Inspector)
- [x] **Basic LLM** mode with real DeepSeek API calls
- [x] Annotated JSON viewers for request, response, memory, and raw trace
- [x] Multi-turn conversation memory
- [x] Trace history with replay
- [x] Vite dev-server proxy (no separate backend needed)
- [x] **Tool Calling** mode with tool schema attachment, tool_call parsing, local tool execution, tool result append, and final LLM synthesis

### Roadmap

| Phase | Mode | Description |
|---|---|---|
| ✅ Done | Basic LLM | Real DeepSeek request/response visualization |
| ✅ Done | **Tool Calling** | Tool schema builder, tool_call parser, tool executor, result append, second model request |
| 📋 Planned | **ReAct** | Action/Observation loop, multi-turn message growth, max-round limit, final answer synthesis |
| 📋 Planned | **Plan-and-Execute** | Planner → Executor → Synthesizer pipeline, plan-to-context flow visualization |

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

Open `http://localhost:5173`, type a prompt, and watch the trace inspector light up.

---

## Tech Stack

| Layer | Choice |
|---|---|
| Frontend | React 19 + TypeScript |
| Build | Vite 6 |
| State | Zustand 5 |
| Icons | Lucide React |
| Styling | Plain CSS (warm palette, three-column CSS Grid) |
| API Proxy | Vite dev-server middleware (`/api/deepseek/chat`) |
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
├── App.tsx       # Main application — all components in one file
├── types.ts      # TypeScript type definitions
├── main.tsx      # React entry point
└── styles.css    # Complete stylesheet
vite.config.ts    # Vite config + DeepSeek API proxy middleware
```

---

## License

MIT
