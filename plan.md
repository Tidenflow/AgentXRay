# AgentXRay → Tauri 桌面端重构计划

> 本文档自包含,供执行编码的模型直接照做。所有行号基于 `refactor` 分支当前代码。执行前先 `git status` 确认在 `refactor` 分支。

## Context(为什么做这件事)

AgentXRay 现在是一个纯 Web 应用(React 19 + Vite 6),但它的"后端"其实是写在 [vite.config.ts](vite.config.ts) `configureServer` 钩子(第 616–1093 行)里的 4 个 dev-server 中间件端点。**这个中间件只在 `vite dev` 下存在;`vite build` 打出的产物是纯静态前端,那 4 个端点会消失**——所以它现在根本无法作为独立应用分发。

目标:用 **Tauri v2** 封装为桌面应用。这是一个**本地工作试验台**,不上线、不批量分发,用户只需填自己的 DeepSeek API key。因此:

- **不引入独立后端进程**。编排逻辑全部搬到前端 TypeScript,由 webview 直接调 DeepSeek。
- Rust 侧保持最薄:只注册 `plugin-sql`(SQLite)和 `plugin-http`(绕 CORS 的 fetch)。
- 用 **SQLite** 持久化实验/trace 历史(当前是纯内存 `useState`,关掉即失)+ 存储用户配置(key/model/baseURL)。
- 用**设置面板**填 API key,取代 `.env`。

## 目标架构

```
React 前端 (webview)
  ├─ src/agent/            ← 从 vite.config.ts 搬来的编排逻辑(4 种模式 + 工具执行)
  │    调 DeepSeek 用 @tauri-apps/plugin-http 的 fetch(绕 CORS)
  ├─ src/config/           ← 读写用户设置(key/baseURL/model/temperature)
  ├─ src/db/               ← SQLite 读写(实验/trace 持久化),用 @tauri-apps/plugin-sql
  └─ src/App.tsx           ← executeMode 改为调 src/agent 里的函数,不再 fetch
src-tauri/ (Rust,极薄)
  ├─ 注册 tauri-plugin-sql + tauri-plugin-http
  ├─ 定义 SQLite migration(建表)
  └─ 无自定义业务逻辑
```

**核心不变量**:`src/agent` 里每个 mode 函数返回的结果对象形状,必须与现在 4 个端点返回的 `DeepSeekResult / ToolCallingResult / ReActResult / PlanExecuteResult` **完全一致**——这样 [src/App.tsx](src/App.tsx) 里现有的 4 个 trace builder(`buildTraceFromDeepSeek` 等,行 207/268/351/409)和 [src/runtime/traceSteps.ts](src/runtime/traceSteps.ts) 无需改动。

---

## 前置条件(执行第一步前必须完成)

当前机器**没有 Rust 工具链**(`cargo`/`rustc` 均不存在)。必须先装:

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"
rustc --version && cargo --version   # 验证
```

Linux 还需 Tauri 系统依赖(webkit2gtk 等),参考 https://tauri.app/start/prerequisites/ 的 Linux 段落。Arch 系:
```bash
sudo pacman -S --needed webkit2gtk-4.1 base-devel curl wget file openssl appmenu-gtk-module libappindicator-gtk3 librsvg
```

---

## 执行步骤

### Phase 0 — Scaffold Tauri v2(不破坏现有前端)

1. 安装依赖:
   ```bash
   npm i -D @tauri-apps/cli@^2
   npm i @tauri-apps/api@^2 @tauri-apps/plugin-http@^2 @tauri-apps/plugin-sql@^2
   ```
2. 初始化 Tauri,**复用现有 Vite 前端**(不要让它生成新前端):
   ```bash
   npx tauri init
   ```
   交互填写:
   - App name: `AgentXRay`
   - Window title: `AgentXRay`
   - Web assets 相对路径(相对 `src-tauri/`): `../dist`
   - Dev server URL: `http://localhost:5173`
   - Frontend dev command: `npm run dev`
   - Frontend build command: `npm run build`
3. 在 `package.json` `scripts` 增加:`"tauri": "tauri"`。
4. 确认生成了 `src-tauri/`(含 `tauri.conf.json`、`Cargo.toml`、`src/main.rs`、`src/lib.rs`、`capabilities/default.json`)。

### Phase 1 — 抽取编排逻辑到 `src/agent/`(核心工作量)

来源全部在 [vite.config.ts](vite.config.ts)。绝大多数是**纯函数,可原样复制**;只有少数需改写。新建以下文件:

**`src/agent/types.ts`** — 复制 vite.config.ts 顶部类型(第 5–80 行区域):`ChatMessage`、`ToolCall`、`ToolDefinition`(27–39)、`ToolExecution`、`ReActStep`(60–68)、`PlanExecuteStep`(70–80)、`ReActParsedStep`。与 [src/types.ts](src/types.ts) 已有类型对齐,避免重复定义(复用 `src/types.ts` 里已导出的)。

**`src/agent/tools.ts`** — 复制这些**纯函数**(全部浏览器兼容,无 Node API):
- `evaluateMathExpression`(vite.config.ts:168–267,手写算术解析器)
- `localToolDefinitions`(118–156,OpenAI 风格 function-tool schema)
- `executeLocalTool`(269–326,dispatch `calculate` / `get_current_datetime`)
- `createToolResultMessage`(328)
- `get_current_datetime` 用 `new Date()` + `Intl.DateTimeFormat`——webview 完全支持,原样保留。

**`src/agent/parsing.ts`** — 复制纯函数:
- `sanitizeModelPayload`(99–116,把响应里的 `reasoning_content` 打码)
- `parseJsonObject`(158)、`extractJsonObject`(344)、`extractJsonObjectFromText`(455)
- `parseReActResponse`(355)、`createReActToolExecution`(389)、`createObservationMessage`(413)、`finalAnswerFromContent`(420)、`reactToolGuide`(335)
- `parsePlan`(472)
- prompt 常量:`plannerSystemPrompt`(423)、`executorSystemPrompt`(433)、`synthesizerSystemPrompt`(445)

**`src/agent/client.ts`** — **需改写** `runChatCompletion`(原 597–614)。改动点:
- import `{ fetch } from '@tauri-apps/plugin-http'`(不用全局 fetch——用插件版绕 CORS/webview 限制,签名一致)。
- 不再从闭包 `env` 读配置;改为函数参数 `config: { baseUrl, apiKey, model }`。
- URL: `` `${baseUrl.replace(/\/$/, "")}/chat/completions` ``,headers `Authorization: Bearer ${apiKey}` + `Content-Type: application/json`。
- 响应:`await res.text()` → `JSON.parse`(容忍空 body → null)→ `sanitizeModelPayload`。
- 返回 `{ ok, status, responsePayload }`。

**`src/agent/runBasic.ts` / `runToolCalling.ts` / `runReact.ts` / `runPlanExecute.ts`** — 把 4 个中间件 handler 改写成**普通 async 函数**。改写规则:
- 签名统一为 `run<Mode>(input: { messages: ChatMessage[]; temperature?: number; maxRounds?: number }, config: AgentConfig): Promise<XxxResult>`。
- **删除** Node-only 部分:`readBody`(82)、`sendJson`(93)、`next()`、`server.middlewares.use` 包装。请求体直接从入参拿。
- **保留**每个 handler 内部的编排流程与 `runChatCompletion` 调用次数,逐段搬:
  - **chat**(641–694):1 次调用。payload `{ model, temperature, messages }`,无 tools。返回 `{ baseUrl, model, durationMs, requestPayload, responsePayload }`。
  - **tool-calling**(696–791):1–2 次。首调带 `tools: localToolDefinitions, tool_choice:"auto"` → 取 `tool_calls` → `executeLocalTool` 每个 → `createToolResultMessage` → follow-up(无 tools,仅当有 toolResult)。返回含 `toolDefinitions, toolExecutions, followUpRequestPayload, followUpResponsePayload`。
  - **react**(793–931):循环最多 `maxRounds`(`Math.max(1, Math.min(maxRounds ?? 4, 8))`,原 815)。每轮 payload **无 tools**(ReAct 靠 prompt 驱动),`parseReActResponse` 解析;有 `finalAnswer` 则 break;否则 `createReActToolExecution` + `createObservationMessage` 追加进 loopMessages;循环结束无 final answer 时追加一次"wrap-up"强制 `Final Answer:`(877–889)。返回含 `reactSteps[], reactToolGuide, finalRequestPayload, finalResponsePayload, finalAnswer, maxRounds`。
  - **plan-execute**(933–1092):Phase1 planner(1 调,`parsePlan`)→ Phase2 executor(每步用 `executePlanStep`,内部 1–2 调,需把 `runChatCompletion` 作为参数/闭包传入)→ Phase3 synthesizer(1 调)。synthesizer 失败仍返回部分数据(1053–1072)。返回含 `plannerRequestPayload/ResponsePayload, plan, steps[], synthesizerRequestPayload/ResponsePayload, finalAnswer, toolDefinitions`。
  - **`executePlanStep`**(488–586)搬进 `runPlanExecute.ts` 或 `agent/parsing.ts`;它已经接受 `runChatCompletion` 作依赖注入,直接传新版 client。
- `durationMs` 用 `performance.now()` 差值(webview 有 `performance`)。原来用 `Date.now()`,同样可用;二选一即可。

**`src/agent/index.ts`** — 导出一个 dispatch:`export async function runMode(mode: AgentModeId, input, config)`,内部 switch 到 4 个 runner。

### Phase 2 — 配置/设置层

**`src/config/settings.ts`** — 定义 `AgentConfig = { apiKey: string; baseUrl: string; model: string; temperature: number }`。默认值:`baseUrl='https://api.deepseek.com'`、`model='deepseek-v4-flash'`、`temperature=0.7`、`apiKey=''`。提供 `loadSettings()/saveSettings()`,底层走 SQLite(见 Phase 4)或简单存 `settings` 表的单行 JSON。

**设置面板 UI**:在 [src/App.tsx](src/App.tsx) 现有的 run-settings 面板(`ChatPane`,`showRunSettings`,行 874–895,含 temperature slider 与 system instructions textarea)旁边/内部,新增字段:API key(`<input type="password">`)、Base URL、Model。保存后写入 settings。**运行前若 `apiKey` 为空**,`runMode` 前置检查并抛出友好错误(替代原 4 个端点里 647/702/799/939 的 missing-key guard)。

### Phase 3 — 改 App.tsx 调用点(最小改动)

改 `executeMode`([src/App.tsx](src/App.tsx):510–553):
- **删除** `fetch(endpoint, ...)`(536–543)与 endpoint 选择(528–535)。
- 改为:`const payload = await runMode(mode, { messages: requestMessages.map(toApiMessage), temperature, maxRounds }, config)`。
- 之后的 4 个 trace builder dispatch(546–552)**保持不变**——因为返回形状一致。
- 错误处理:`runMode` 内部失败时 throw,现有 try/catch(`runTrace` 557–588 及 experiment.errors)沿用。

**可选修复(建议顺带做)**:现在前端从不传 `maxRounds`,ReAct 恒为 4 轮。在 run-settings 面板加一个 maxRounds 数字输入(1–8),经 `input.maxRounds` 传入 `runReact`。README 已把"统一步骤语言/错误态"列入 roadmap,这个小修正与之契合。

### Phase 4 — SQLite 持久化(用 tauri-plugin-sql)

1. **Rust 侧**(`src-tauri/src/lib.rs`):注册插件并定义 migration 建表:
   ```rust
   use tauri_plugin_sql::{Migration, MigrationKind};
   // migrations: create tables experiments, trace_runs, settings
   .plugin(tauri_plugin_sql::Builder::default()
       .add_migrations("sqlite:agentxray.db", migrations)
       .build())
   .plugin(tauri_plugin_http::init())
   ```
   `Cargo.toml` 加 `tauri-plugin-sql = { version = "2", features = ["sqlite"] }` 和 `tauri-plugin-http = "2"`。
2. **表设计**(最小):
   - `settings(key TEXT PRIMARY KEY, value TEXT)` — 存 apiKey/baseUrl/model/temperature。
   - `experiments(id TEXT PK, prompt TEXT, created_at INTEGER, errors TEXT)` — errors 存 JSON。
   - `trace_runs(id TEXT PK, experiment_id TEXT, mode TEXT, turn_number INTEGER, created_at INTEGER, payload TEXT)` — 整个 `TraceRun` 序列化为 JSON 存 `payload`(避免拆列,`TraceRun` 字段多且嵌套)。
3. **`src/db/index.ts`**:`import Database from '@tauri-apps/plugin-sql'; const db = await Database.load('sqlite:agentxray.db')`。封装 `saveExperiment`/`saveTraceRun`/`loadExperiments`/`loadTraceRuns`/`getSetting`/`setSetting`。
4. **接入 App.tsx**:
   - 启动时 `useEffect` 从 DB 载入 `experiments`/`traces` 填充现有 `useState`(行 471–486)。
   - `runTrace` 里 push 新 trace/experiment 后,同步写 DB(`saveTraceRun`/`saveExperiment`)。
   - 注意:`Experiment` 形状在 [src/App.tsx](src/App.tsx):29–35,`TraceRun` 在 [src/types.ts](src/types.ts):112–129,序列化/反序列化保持字段完整。

### Phase 5 — Tauri 权限 + 清理

1. **HTTP 权限**(`src-tauri/capabilities/default.json`):加入 `plugin-sql` 与 `plugin-http` 权限,并给 http 配置允许访问 DeepSeek 域的 scope:
   ```json
   "permissions": [
     "core:default",
     "sql:default", "sql:allow-execute", "sql:allow-select", "sql:allow-load",
     { "identifier": "http:default", "allow": [{ "url": "https://api.deepseek.com/*" }] }
   ]
   ```
   若用户会改 baseUrl 指向别的兼容端点,scope 需相应放宽(试验台可用 `"https://*/*"` 但需知晓风险)。
2. **删除 dev-server 代理**:清空 [vite.config.ts](vite.config.ts) 里 `agent-xray-deepseek-api` 插件(第 616–1093 的 `configureServer` 整块及相关 module 级 Node-only helper `readBody`/`sendJson`)。保留 `react()` 插件与基本 Vite 配置。
3. **移除 `.env` 依赖**:`.env` / `.env.example` 不再被读取。可保留文件但在 README 说明改为设置面板;或删除。前端不再有任何 `DEEPSEEK_` 引用(现在也没有)。

### Phase 6 — 构建与验证

```bash
npm run tauri dev      # 开发:起 Vite + Tauri 窗口
npm run tauri build    # 产物:桌面安装包
npm run test           # 现有 vitest(traceSteps.test.ts)必须仍通过
tsc --noEmit           # 类型检查通过
```

---

## 关键陷阱(务必注意)

1. **必须用 `@tauri-apps/plugin-http` 的 `fetch`,不是全局 `fetch`**。全局 fetch 在 webview 里调 api.deepseek.com 会被 CORS 拦;插件版经 Rust 转发,绕过 CORS。签名一致,只改 import。
2. **结果对象形状不能变**。4 个 runner 的返回必须逐字段匹配现有 Result 类型,否则 trace builder 与 traceSteps 全挂。搬迁时对照 [vite.config.ts](vite.config.ts) 每个 handler 的 return。
3. **`process.cwd()` / `loadEnv` / `node:http` 不能进前端**。这些只在原 config 层;搬迁时全部丢弃,配置改从 settings 来。
4. **`Intl` / `performance` / `Date` 在 webview 都可用**,工具与计时逻辑无需改。
5. **`executePlanStep` 靠依赖注入拿 `runChatCompletion`**——搬迁时保持这个注入,把新版 client 传进去。
6. **SQLite 的 `TraceRun` 建议整体 JSON 存**,不要拆成多列——它字段多且含嵌套 payload,拆列得不偿失。
7. 现在 `zustand` 是 package.json 依赖但**全项目未使用**(全是 `useState`)。本重构**不引入 zustand**;持久化直接用 SQLite + 现有 useState 即可,保持简单。可顺手从 package.json 移除 zustand。

---

## 关键文件清单

| 文件 | 动作 |
|---|---|
| `src-tauri/**`(新) | Tauri scaffold + Rust 注册 sql/http 插件 + migration |
| `src/agent/{types,tools,parsing,client,runBasic,runToolCalling,runReact,runPlanExecute,index}.ts`(新) | 从 vite.config.ts 搬来的编排逻辑 |
| `src/config/settings.ts`(新) | 用户配置读写 |
| `src/db/index.ts`(新) | SQLite 封装 |
| [src/App.tsx](src/App.tsx) | 改 `executeMode`(510–553)调 `runMode`;加设置面板字段;启动载入/运行写入 DB |
| [vite.config.ts](vite.config.ts) | 删除 `configureServer` 代理块(616–1093)与 Node-only helper |
| `package.json` | 加 tauri 依赖与 `tauri` script;可移除 zustand |
| `.env` / `.env.example` | 不再使用;README 相应更新 |
| [src/types.ts](src/types.ts) / [src/runtime/traceSteps.ts](src/runtime/traceSteps.ts) | **不改**(形状不变前提下) |

## 验证清单(端到端)

- [ ] `npm run tauri dev` 起窗口,设置面板填入真实 DeepSeek key。
- [ ] 4 种模式各跑一个 README 示例 prompt,trace inspector 正常渲染(Sent to LLM / LLM Response / Tool Calls / Memory / Raw Trace)。
- [ ] 关闭并重开 app,实验/trace 历史仍在(SQLite 持久化生效)。
- [ ] `npm run test` 与 `tsc --noEmit` 通过。
- [ ] `npm run tauri build` 产出可运行安装包。
