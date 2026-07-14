# ReAct Runtime Timeline Design

## Goal

Present the existing real ReAct execution through the same Runtime Timeline and Step Inspector used by Basic LLM and Tool Calling. ReAct must feel like a natural extension of the existing workbench, not a separate visualization product.

The visualization must explain the distinctive ReAct control loop accurately:

```text
model response
→ parse Thought / Action / Action Input
→ execute the selected tool
→ append Observation to the message stack
→ call the model again
→ repeat until Final Answer or the round limit
```

## Scope

In scope:

- Map a ReAct trace into the shared `RuntimeStep[]` representation.
- Render ReAct with the existing `RuntimeTimeline` and `RuntimeStepInspector` components.
- Group shared setup, individual ReAct rounds, fallback synthesis, and completion without changing the visual language used by the first two modes.
- Expose the actual request payloads, provider responses, parsed protocol fields, tool execution results, Observation messages, message-stack changes, and loop decisions already returned by the server.
- Explain that a `Thought:` field is explicit provider-returned text, not hidden chain-of-thought.
- Cover direct answers, one or more tool rounds, parse/tool failures, and maximum-round fallback.

Out of scope:

- A new standalone ReAct UI or a redesign of the shared workbench.
- Changing ReAct into native provider `tool_calls`; its text protocol is the characteristic being inspected.
- Exposing or claiming access to private model reasoning.
- New tools, external tool servers, streaming, trace export, or Plan-and-Execute migration.

## Existing Runtime Contract

The server already implements the real ReAct loop at `/api/deepseek/react`:

1. It receives the initial system and user messages.
2. It requests a model response for each round.
3. It parses `Thought`, `Action`, `Action Input`, or `Final Answer` from visible assistant content.
4. For an action, it routes and executes the local tool.
5. It appends the assistant response plus a user-role `Observation:` message.
6. It repeats for up to the clamped `maxRounds` value.
7. If no final answer appears, it sends a final synthesis request after the round limit.

The endpoint returns the evidence required by the visualization through `reactSteps`, `finalRequestPayload`, `finalResponsePayload`, `finalAnswer`, `reactToolGuide`, and `maxRounds`. This feature consumes that contract. It does not invent steps that were not executed.

## Architecture

### Shared types

Add an optional group label to `RuntimeStep`. The timeline uses it to insert lightweight section markers such as `准备阶段`, `Round 1`, `Round 2`, and `完成`. Basic LLM and Tool Calling omit the field and retain their current output unchanged.

### Trace mapping

Extend `runtimeStepsFromTrace` with a ReAct mapper in `src/runtime/traceSteps.ts`. The mapper remains a pure function:

```text
TraceRun(mode=react) → ReActResult evidence → RuntimeStep[]
```

It must tolerate incomplete evidence and render the information that is available rather than crashing the inspector.

### Existing components

`App.tsx` routes ReAct through the same two components already used by Basic LLM and Tool Calling:

- Center pane: `RuntimeTimeline`
- Right pane: `RuntimeStepInspector`

The legacy `ReActChatView` may remain temporarily for code compatibility, but it is no longer the active ReAct presentation. No new ReAct-specific inspector component is introduced.

## Runtime Step Model

### Shared setup

1. **接收用户目标**
   - Actor: user
   - Visibility: observed
   - Evidence: original prompt

2. **组装 ReAct 初始请求**
   - Actor: runtime
   - Visibility: observed
   - Evidence: messages, explicit ReAct protocol/tool guide, request payload, max-round setting

### Each ReAct round

For every item in `reactSteps`, emit steps with stable IDs containing the round number.

1. **Round N：模型生成下一步**
   - Actor: model
   - Visibility: inferred
   - Input: the exact messages in that round's request payload
   - Output: visible assistant content exposed by the provider

2. **Round N：模型服务包装响应**
   - Actor: provider
   - Visibility: observed
   - Input: returned assistant message
   - Output/raw: complete round response payload

3. **Round N：解析 ReAct 协议**
   - Actor: runtime
   - Visibility: observed
   - Input: visible assistant content
   - Output: parsed `thought`, `action`, `actionInput`, `finalAnswer`, and `parseError`
   - Transition: either execute an action, finish with a final answer, or record a parse failure

4. **Round N：执行工具** when an execution exists
   - Actor: tool
   - Visibility: observed
   - Input: parsed tool name and arguments
   - Output: result, success state, or error

5. **Round N：追加 Observation** when an Observation exists
   - Actor: runtime
   - Visibility: observed
   - Input: tool execution result
   - State change: assistant protocol response and Observation appended to the message stack
   - Output/raw: the next round request payload when available

### Maximum-round fallback

When `finalRequestPayload` exists, emit explicit steps showing that the normal loop reached its limit, the runtime assembled a forced final-answer request, and the model/provider returned the fallback response. This must not be presented as another tool round.

### Completion

Emit one final **展示最终回答** step using `trace.finalAnswer`. Its transition reason distinguishes normal `Final Answer` completion from maximum-round fallback where the evidence permits it.

## Visual Design

The ReAct view uses the same card shapes, actor badges, visibility labels, selection state, spacing, and inspector artifact sections as Basic LLM and Tool Calling.

The only new visual element is a small group marker before the first step of each round. It organizes a potentially long trace without turning the page into a different interface. Step cards remain individually selectable.

The inspector labels explicit `Thought:` content as observable assistant text and includes this boundary statement:

> 这是模型服务返回的显式文本，不代表模型未公开的隐藏思维过程。

## Error and Edge Handling

- **Direct final answer:** a round with `Final Answer` renders model, provider, parse, and completion steps without tool or Observation steps.
- **Parse error:** the parser step shows `parseError` and the raw assistant content. If the runtime generated a failed tool execution/Observation, those executed facts are also shown.
- **Unknown tool or invalid arguments:** the tool step displays `ok: false` and the actual error; the following Observation shows how the failure was fed back to the model.
- **Empty provider content:** render an empty-content explanation instead of throwing.
- **Maximum rounds:** show the round-limit decision and fallback request/response explicitly.
- **Partial trace:** use empty arrays/null artifacts where evidence is missing and keep the timeline usable.

## Testing

Add focused unit tests for the pure ReAct trace mapper. Fixtures cover:

1. Direct `Final Answer` in round one.
2. One tool action, Observation, then final answer.
3. Multiple tool rounds with message-stack growth.
4. Parse failure or unknown tool execution.
5. Maximum-round fallback with final request and response.
6. Incomplete evidence does not throw.
7. Existing Basic LLM and Tool Calling step mappings remain unchanged.

The implementation is complete only when TypeScript compilation and the focused tests pass.

## Success Criteria

- Selecting ReAct displays the same Runtime Timeline and Step Inspector used by Basic LLM and Tool Calling.
- Every real ReAct round can be followed from request to response, parsed decision, tool execution, Observation append, and next request.
- Users can see why the runtime continued or stopped at every round.
- The interface clearly distinguishes visible ReAct text from hidden model reasoning.
- Direct-answer, multi-round, error, and round-limit paths remain inspectable.
- Basic LLM and Tool Calling behavior and styling do not regress.
