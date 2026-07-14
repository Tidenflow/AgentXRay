import type { RuntimeStep, ToolCall, ToolExecution, TraceRun } from "../types";

type ApiMessage = {
  role?: string;
  content?: string | null;
  tool_calls?: ToolCall[];
};

type ApiPayload = {
  model?: string;
  messages?: ApiMessage[];
  tools?: unknown[];
  choices?: Array<{ message?: ApiMessage }>;
};

type ToolTraceInput = {
  initialRequestPayload?: ApiPayload;
  toolDefinitions?: unknown[];
  toolExecutions?: ToolExecution[];
  followUpRequestPayload?: ApiPayload | null;
};

type ToolTraceOutput = {
  initialResponsePayload?: ApiPayload;
  toolExecutions?: ToolExecution[];
  followUpResponsePayload?: ApiPayload | null;
};

type ReActTraceStep = {
  round: number;
  assistantContent: string;
  parsed: {
    thought?: string;
    action?: string;
    actionInput?: unknown;
    finalAnswer?: string;
    parseError?: string;
  };
  toolExecution?: ToolExecution;
  observationMessage?: { role: 'user'; content: string };
  requestPayload: unknown;
  responsePayload: unknown;
};

type ReActTraceData = {
  requestPayload?: ApiPayload | null;
  responsePayload?: ApiPayload | null;
  reactToolGuide?: string;
  reactSteps?: ReActTraceStep[];
  finalRequestPayload?: ApiPayload | null;
  finalResponsePayload?: ApiPayload | null;
  finalAnswer?: string;
  maxRounds?: number;
};

type PlanTraceStep = {
  step: number;
  description: string;
  executorSystemPrompt: string;
  executorRequestPayload: unknown;
  executorResponsePayload: unknown;
  toolExecutions: ToolExecution[];
  followUpRequestPayload: unknown | null;
  followUpResponsePayload: unknown | null;
  stepResult: string;
};

type PlanExecuteTraceData = {
  plannerRequestPayload?: ApiPayload;
  plannerResponsePayload?: ApiPayload;
  plan?: string[];
  steps?: PlanTraceStep[];
  synthesizerRequestPayload?: ApiPayload;
  synthesizerResponsePayload?: ApiPayload;
  finalAnswer?: string;
  toolDefinitions?: unknown[];
};

const step = (value: RuntimeStep) => value;

export function runtimeStepsFromTrace(trace: TraceRun): RuntimeStep[] {
  if (trace.mode === 'react') return reactRuntimeSteps(trace);
  if (trace.mode === 'plan-execute') return planExecuteRuntimeSteps(trace);
  if (trace.mode === "tool-calling") return toolCallingSteps(trace);
  if (trace.mode === "basic") return basicSteps(trace);
  return legacySteps(trace);
}

function basicSteps(trace: TraceRun): RuntimeStep[] {
  const request = trace.requestPayload as ApiPayload;
  const response = trace.responsePayload as ApiPayload;
  const providerMessage = response.choices?.[0]?.message;

  return [
    step({
      id: "goal",
      kind: "input",
      title: "接收用户目标",
      summary: trace.userPrompt,
      actor: "user",
      visibility: "observed",
      transitionReason: "Agent Runtime 根据这段用户输入启动一次模型调用。",
      output: [{ label: "用户文本", value: trace.userPrompt, format: "text" }],
    }),
    step({
      id: "assemble",
      kind: "context",
      title: "组装模型请求",
      summary: `Runtime 将 ${request.messages?.length ?? 0} 条消息序列化为模型服务要求的 API 请求。`,
      actor: "runtime",
      visibility: "observed",
      transitionReason: "模型服务要求使用约定的 HTTP JSON 格式提交模型配置和消息。",
      input: [{ label: "Runtime 消息", value: request.messages ?? [], format: "json" }],
      output: [{ label: "HTTP 请求体", value: request, format: "json" }],
    }),
    step({
      id: "model-call",
      kind: "model",
      title: "模型生成 Token",
      summary: "模型根据收到的上下文生成一段 Assistant Token 序列。",
      actor: "model",
      visibility: "inferred",
      transitionReason: "生成结果将通过模型服务的 Chat Completion 协议返回。",
      input: [{ label: "模型接收到的消息", value: request.messages ?? [], format: "json" }],
      output: [{ label: "生成的 Assistant 内容", value: providerMessage?.content ?? "", format: "text" }],
    }),
    step({
      id: "provider-envelope",
      kind: "provider",
      title: "模型服务包装响应",
      summary: "DeepSeek 将生成内容放在 choices[0].message.content 中返回。",
      actor: "provider",
      visibility: "observed",
      transitionReason: "Runtime 接下来从 API 响应外壳中提取 Assistant 内容。",
      input: [{ label: "Assistant 消息", value: providerMessage ?? null, format: "json" }],
      output: [{ label: "API 响应", value: response, format: "json" }],
    }),
    step({
      id: "final",
      kind: "output",
      title: "展示最终回答",
      summary: trace.finalAnswer || "模型没有返回文本内容。",
      actor: "runtime",
      visibility: "observed",
      transitionReason: "没有工具调用，也不需要执行其他 Runtime 操作，本次运行结束。",
      input: [{ label: "提取出的内容", value: providerMessage?.content ?? "", format: "text" }],
      output: [{ label: "展示给用户的回答", value: trace.finalAnswer, format: "text" }],
    }),
  ];
}

function toolCallingSteps(trace: TraceRun): RuntimeStep[] {
  const input = trace.requestPayload as ToolTraceInput;
  const output = trace.responsePayload as ToolTraceOutput;
  const request = input.initialRequestPayload ?? {};
  const response = output.initialResponsePayload ?? {};
  const firstMessage = response.choices?.[0]?.message;
  const calls = firstMessage?.tool_calls ?? [];
  const executions = input.toolExecutions ?? output.toolExecutions ?? [];
  const steps: RuntimeStep[] = [
    step({ id: "goal", kind: "input", title: "接收用户目标", summary: trace.userPrompt, actor: "user", visibility: "observed", transitionReason: "Runtime 启动一次具备工具感知能力的模型调用。", output: [{ label: "用户文本", value: trace.userPrompt, format: "text" }] }),
    step({ id: "expose-tools", kind: "context", title: "向模型声明可用工具", summary: `请求中附加了 ${input.toolDefinitions?.length ?? request.tools?.length ?? 0} 个工具定义。`, actor: "runtime", visibility: "observed", transitionReason: "模型必须先知道工具名称、用途和参数结构，才能提出工具调用请求。", input: [{ label: "对话消息", value: request.messages ?? [], format: "json" }], output: [{ label: "工具 Schema", value: input.toolDefinitions ?? request.tools ?? [], format: "json" }], raw: [{ label: "第一次请求体", value: request, format: "json" }] }),
    step({ id: "tool-model-call", kind: "model", title: "模型选择下一步行动", summary: calls.length ? `模型请求调用 ${calls.length} 个工具。` : "模型没有请求工具，而是直接生成回答。", actor: "model", visibility: "inferred", transitionReason: calls.length ? "经过 Tool Calling 训练的模型生成了模型服务能够识别的工具调用表示。" : "响应中只有普通 Assistant 内容，因此可以结束执行。", input: [{ label: "消息与工具定义", value: request, format: "json" }], output: [{ label: "模型服务暴露的模型决策", value: firstMessage ?? null, format: "json" }] }),
    step({ id: "provider-decode", kind: "provider", title: "模型服务解析工具调用序列", summary: calls.length ? "DeepSeek 将模型决策暴露为 message.tool_calls。" : "DeepSeek 将模型输出暴露为 message.content。", actor: "provider", visibility: "provider-managed", transitionReason: calls.length ? "AgentXRay 能观察 tool_calls，但无法看到模型服务内部如何解析特殊 Token。" : "模型服务没有返回结构化工具请求。", input: [{ label: "模型服务内部的模型输出", value: "API 不会暴露内部 Token 表示。", format: "text" }], output: [{ label: "结构化 Assistant 消息", value: firstMessage ?? null, format: "json" }], raw: [{ label: "第一次 API 响应", value: response, format: "json" }] }),
  ];

  calls.forEach((call, index) => {
    const execution = executions[index];
    steps.push(step({ id: `parse-${call.id}`, kind: "parse", title: `解析 ${call.function.name} 请求`, summary: execution?.ok === false ? "Runtime 无法校验或执行这个请求。" : "Runtime 将参数字符串转换为可以传给本地代码的参数值。", actor: "runtime", visibility: "observed", transitionReason: "根据 function.name 在本地工具注册表中查找对应函数。", input: [{ label: "原始 arguments 字符串", value: call.function.arguments, format: "code" }], output: [{ label: "解析后的参数", value: execution?.arguments ?? call.function.arguments, format: "json" }, { label: "工具路由键", value: call.function.name, format: "text" }] }));
    steps.push(step({ id: `execute-${call.id}`, kind: "tool", title: `执行 ${call.function.name}`, summary: execution?.ok === false ? execution.error ?? "工具执行失败。" : "Runtime 调用本地代码；模型本身不会执行工具。", actor: "tool", visibility: "observed", transitionReason: "将工具结果序列化，并关联到对应的 tool_call_id。", input: [{ label: "函数参数", value: execution?.arguments ?? null, format: "json" }], output: [{ label: "工具执行结果", value: execution?.content ?? null, format: "json" }] }));
  });

  if (input.followUpRequestPayload) {
    steps.push(step({ id: "append-result", kind: "observation", title: "将工具结果写回上下文", summary: "Runtime 把 Assistant 工具请求和 role=tool 结果追加到消息历史。", actor: "runtime", visibility: "observed", transitionReason: "模型需要读取外部工具结果，才能生成有事实依据的最终回答。", stateChange: [{ label: "工具执行后的消息列表", value: input.followUpRequestPayload.messages ?? [], format: "json" }], raw: [{ label: "第二次请求体", value: input.followUpRequestPayload, format: "json" }] }));
    steps.push(step({ id: "second-call", kind: "model", title: "根据工具结果生成回答", summary: "模型接收原始目标和工具结果，然后生成普通 Assistant 文本。", actor: "model", visibility: "inferred", transitionReason: "模型服务返回最终的 Assistant 消息。", input: [{ label: "更新后的消息", value: input.followUpRequestPayload.messages ?? [], format: "json" }], output: [{ label: "最终模型服务响应", value: output.followUpResponsePayload ?? null, format: "json" }] }));
  }

  steps.push(step({ id: "final", kind: "output", title: "展示最终回答", summary: trace.finalAnswer || "没有返回最终文本。", actor: "runtime", visibility: "observed", transitionReason: "本次运行已经完成。", output: [{ label: "展示给用户的回答", value: trace.finalAnswer, format: "text" }] }));
  return steps;
}

function reactRuntimeSteps(trace: TraceRun): RuntimeStep[] {
  const data = trace.requestPayload as ReActTraceData;
  const rounds = data.reactSteps ?? [];
  const initialRequest = data.requestPayload ?? (rounds[0]?.requestPayload as ApiPayload | undefined) ?? {};
  const steps: RuntimeStep[] = [
    step({ id: 'goal', group: '准备阶段', kind: 'input', title: '接收用户目标', summary: trace.userPrompt, actor: 'user', visibility: 'observed', transitionReason: 'Runtime 根据用户目标启动 ReAct 循环。', output: [{ label: '用户文本', value: trace.userPrompt, format: 'text' }] }),
    step({
      id: 'react-assemble',
      group: '准备阶段',
      kind: 'context',
      title: '组装 ReAct 初始请求',
      summary: `Runtime 注入 ReAct 文本协议，并设置最多 ${data.maxRounds ?? rounds.length} 轮执行。`,
      actor: 'runtime',
      visibility: 'observed',
      transitionReason: '模型需要明确的 Thought / Action / Action Input / Final Answer 协议和可用工具说明。',
      input: [
        { label: '初始消息', value: initialRequest.messages ?? [], format: 'json' },
        { label: 'ReAct 工具说明', value: data.reactToolGuide ?? '', format: 'text' },
      ],
      output: [{ label: '第一轮请求体', value: initialRequest, format: 'json' }],
    }),
  ];

  rounds.forEach((round, index) => {
    const group = `Round ${round.round}`;
    const request = round.requestPayload as ApiPayload;
    const response = round.responsePayload as ApiPayload;
    const providerMessage = response?.choices?.[0]?.message;
    const parsed = round.parsed ?? {};

    steps.push(step({
      id: `react-round-${round.round}-model`, group, kind: 'model', title: `Round ${round.round}：模型生成下一步`,
      summary: parsed.finalAnswer ? '模型输出 Final Answer，准备结束循环。' : parsed.action ? `模型输出 Action ${parsed.action}。` : '模型返回了一段需要 Runtime 解析的 ReAct 文本。',
      actor: 'model', visibility: 'inferred', transitionReason: '生成结果通过模型服务的 Chat Completion 响应返回给 Runtime。',
      input: [{ label: '本轮模型消息', value: request?.messages ?? [], format: 'json' }],
      output: [{ label: '显式 Assistant 文本', value: round.assistantContent ?? '', format: 'text' }],
    }));

    steps.push(step({
      id: `react-round-${round.round}-provider`, group, kind: 'provider', title: `Round ${round.round}：模型服务包装响应`,
      summary: 'DeepSeek 将模型生成的 ReAct 文本放入 Assistant message.content。', actor: 'provider', visibility: 'observed',
      transitionReason: 'Runtime 接下来解析可观察的 Assistant 文本，决定执行工具还是结束循环。',
      input: [{ label: 'Assistant 消息', value: providerMessage ?? null, format: 'json' }],
      output: [{ label: '本轮 API 响应', value: response ?? null, format: 'json' }],
      raw: [{ label: '本轮请求体', value: request ?? null, format: 'json' }],
    }));

    steps.push(step({
      id: `react-round-${round.round}-parse`, group, kind: 'parse', title: `Round ${round.round}：解析 ReAct 协议`,
      summary: parsed.finalAnswer ? 'Runtime 识别到 Final Answer。' : parsed.action ? `Runtime 识别到 ${parsed.action} 及其输入参数。` : parsed.parseError ?? 'Runtime 未识别到有效的 Action 或 Final Answer。',
      actor: 'runtime', visibility: 'observed',
      transitionReason: parsed.finalAnswer ? 'Runtime 识别到 Final Answer，结束 ReAct 循环。' : parsed.action ? `Runtime 识别到 Action ${parsed.action}，进入工具路由与执行。` : 'Runtime 将解析失败作为 Observation 反馈给下一轮。',
      input: [{ label: '显式 Assistant 文本', value: round.assistantContent ?? '', format: 'text' }],
      output: [
        { label: '解析结果', value: parsed, format: 'json' },
        { label: '可观察边界', value: 'Thought 是模型服务返回的显式文本，不代表模型未公开的隐藏思维过程。', format: 'text' },
      ],
    }));

    if (round.toolExecution) {
      steps.push(step({
        id: `react-round-${round.round}-tool`, group, kind: 'tool', title: `Round ${round.round}：执行 ${round.toolExecution.name}`,
        summary: round.toolExecution.ok ? 'Runtime 调用本地工具并获得可观察结果；模型本身不会执行工具。' : round.toolExecution.error ?? '工具执行失败。',
        actor: 'tool', visibility: 'observed', transitionReason: 'Runtime 将工具结果包装为 Observation，并追加到下一轮上下文。',
        input: [
          { label: '工具名称', value: round.toolExecution.name, format: 'text' },
          { label: '解析后的参数', value: round.toolExecution.arguments, format: 'json' },
        ],
        output: [
          { label: '执行结果', value: round.toolExecution.content, format: 'text' },
          { label: '执行状态', value: { ok: round.toolExecution.ok, error: round.toolExecution.error }, format: 'json' },
        ],
      }));
    }

    if (round.observationMessage) {
      const nextRequest = (rounds[index + 1]?.requestPayload ?? data.finalRequestPayload) as ApiPayload | null | undefined;
      steps.push(step({
        id: `react-round-${round.round}-observation`, group, kind: 'observation', title: `Round ${round.round}：追加 Observation`,
        summary: 'Runtime 把 Assistant 行动文本和 Observation 追加到消息历史。', actor: 'runtime', visibility: 'observed',
        transitionReason: nextRequest ? '更新后的消息栈将作为下一次模型请求的上下文。' : 'Observation 已记录，Runtime 准备进入下一轮。',
        input: [{ label: 'Observation 消息', value: round.observationMessage, format: 'json' }],
        stateChange: [{ label: '更新后的消息列表', value: nextRequest?.messages ?? [], format: 'json' }],
        raw: nextRequest ? [{ label: '下一次请求体', value: nextRequest, format: 'json' }] : undefined,
      }));
    }
  });

  if (data.finalRequestPayload) {
    const fallbackMessage = data.finalResponsePayload?.choices?.[0]?.message;
    steps.push(step({
      id: 'react-round-limit', group: '轮次上限', kind: 'decision', title: '达到最大 ReAct 轮数',
      summary: `循环在 ${data.maxRounds ?? rounds.length} 轮后仍未得到 Final Answer。`, actor: 'runtime', visibility: 'observed',
      transitionReason: 'Runtime 停止继续调用工具，改为要求模型基于已有 Observation 生成最终回答。',
      output: [{ label: '最终回答请求体', value: data.finalRequestPayload, format: 'json' }],
    }));
    steps.push(step({
      id: 'react-fallback-model', group: '轮次上限', kind: 'model', title: '根据已有 Observation 生成回答',
      summary: '模型基于累积消息生成一次尽力而为的最终回答。', actor: 'model', visibility: 'inferred',
      transitionReason: '模型服务将最终内容包装为 Chat Completion 响应。',
      input: [{ label: '最终上下文', value: data.finalRequestPayload.messages ?? [], format: 'json' }],
      output: [{ label: '生成的 Assistant 内容', value: fallbackMessage?.content ?? '', format: 'text' }],
    }));
    steps.push(step({
      id: 'react-fallback-provider', group: '轮次上限', kind: 'provider', title: '模型服务返回最终响应',
      summary: 'DeepSeek 返回最大轮数后的最终合成结果。', actor: 'provider', visibility: 'observed',
      transitionReason: 'Runtime 从响应中提取最终回答并结束本次运行。',
      output: [{ label: '最终 API 响应', value: data.finalResponsePayload ?? null, format: 'json' }],
    }));
  }

  steps.push(step({
    id: 'final', group: '完成', kind: 'output', title: '展示最终回答', summary: trace.finalAnswer || '没有返回最终文本。',
    actor: 'runtime', visibility: 'observed',
    transitionReason: data.finalRequestPayload ? '最大轮数后的最终合成已完成，本次运行结束。' : 'Runtime 已识别到 Final Answer，本次 ReAct 循环结束。',
    output: [{ label: '展示给用户的回答', value: trace.finalAnswer, format: 'text' }],
  }));

  return steps;
}

function planExecuteRuntimeSteps(trace: TraceRun): RuntimeStep[] {
  const data = trace.requestPayload as PlanExecuteTraceData;
  const plannerRequest = data.plannerRequestPayload ?? {};
  const plannerResponse = data.plannerResponsePayload ?? {};
  const plannerMessage = plannerResponse.choices?.[0]?.message;
  const plan = data.plan ?? [];
  const executorSteps = data.steps ?? [];
  const steps: RuntimeStep[] = [
    step({
      id: 'goal', group: '准备阶段', kind: 'input', title: '接收用户目标', summary: trace.userPrompt,
      actor: 'user', visibility: 'observed', transitionReason: 'Runtime 将用户目标交给 Planner 进行任务分解。',
      output: [{ label: '用户目标', value: trace.userPrompt, format: 'text' }],
    }),
    step({
      id: 'plan-planner-request', group: 'Planner', kind: 'context', title: '组装 Planner 请求',
      summary: 'Runtime 构造只负责拆解任务、不直接执行任务的 Planner 上下文。', actor: 'runtime', visibility: 'observed',
      transitionReason: 'Planner 需要基于原始目标生成一组有顺序的可执行步骤。',
      input: [{ label: 'Planner 消息', value: plannerRequest.messages ?? [], format: 'json' }],
      output: [{ label: 'Planner 请求体', value: plannerRequest, format: 'json' }],
    }),
    step({
      id: 'plan-planner-model', group: 'Planner', kind: 'model', title: 'Planner 生成执行计划',
      summary: `模型为当前目标生成 ${plan.length} 个候选执行步骤。`, actor: 'model', visibility: 'inferred',
      transitionReason: '模型服务将计划文本包装为 Chat Completion 响应。',
      input: [{ label: 'Planner 输入消息', value: plannerRequest.messages ?? [], format: 'json' }],
      output: [{ label: '模型生成的计划文本', value: plannerMessage?.content ?? '', format: 'text' }],
    }),
    step({
      id: 'plan-planner-provider', group: 'Planner', kind: 'provider', title: '模型服务返回 Planner 响应',
      summary: 'DeepSeek 将 Planner 输出放入 Assistant message.content。', actor: 'provider', visibility: 'observed',
      transitionReason: 'Runtime 接下来从可观察文本中解析结构化步骤列表。',
      input: [{ label: 'Planner Assistant 消息', value: plannerMessage ?? null, format: 'json' }],
      output: [{ label: 'Planner API 响应', value: plannerResponse, format: 'json' }],
    }),
    step({
      id: 'plan-planner-parse', group: 'Planner', kind: 'parse', title: '解析有序执行计划',
      summary: `Runtime 得到 ${plan.length} 个按顺序执行的步骤。`, actor: 'runtime', visibility: 'observed',
      transitionReason: plan.length ? 'Runtime 从第一步开始顺序执行计划。' : '没有可执行步骤，Runtime 将直接进入结果合成阶段。',
      input: [{ label: 'Planner 原始文本', value: plannerMessage?.content ?? '', format: 'text' }],
      output: [{ label: '结构化 Plan', value: plan, format: 'json' }],
    }),
  ];

  executorSteps.forEach((executor) => {
    const group = `Executor · Step ${executor.step}`;
    const request = executor.executorRequestPayload as ApiPayload;
    const response = executor.executorResponsePayload as ApiPayload;
    const assistantMessage = response?.choices?.[0]?.message;
    const calls = assistantMessage?.tool_calls ?? [];
    const executions = executor.toolExecutions ?? [];

    steps.push(step({
      id: `plan-executor-${executor.step}-request`, group, kind: 'context', title: `构造 Step ${executor.step} 执行上下文`,
      summary: executor.description, actor: 'runtime', visibility: 'observed',
      transitionReason: '每个 Executor Step 使用自己的系统指令、当前步骤和完整计划独立调用模型。',
      input: [
        { label: '当前步骤', value: executor.description, format: 'text' },
        { label: 'Executor System Prompt', value: executor.executorSystemPrompt, format: 'text' },
      ],
      output: [{ label: 'Executor 请求体', value: request, format: 'json' }],
    }));
    steps.push(step({
      id: `plan-executor-${executor.step}-model`, group, kind: 'model', title: `Step ${executor.step}：模型执行计划步骤`,
      summary: calls.length ? `模型请求调用 ${calls.length} 个工具。` : '模型直接生成该步骤的结果。',
      actor: 'model', visibility: 'inferred',
      transitionReason: calls.length ? '模型服务将工具调用表示解码为结构化 tool_calls。' : '模型服务返回普通 Assistant 内容作为步骤结果。',
      input: [{ label: '步骤消息与工具定义', value: request, format: 'json' }],
      output: [{ label: '模型服务暴露的决策', value: assistantMessage ?? null, format: 'json' }],
    }));
    steps.push(step({
      id: `plan-executor-${executor.step}-provider`, group, kind: 'provider', title: `Step ${executor.step}：模型服务包装响应`,
      summary: calls.length ? 'DeepSeek 将模型决策暴露为 message.tool_calls。' : 'DeepSeek 将步骤结果暴露为 message.content。',
      actor: 'provider', visibility: calls.length ? 'provider-managed' : 'observed',
      transitionReason: calls.length ? 'Runtime 将解析并路由每一个工具调用。' : '没有工具调用，Runtime 可以直接记录 Step Result。',
      output: [{ label: 'Executor API 响应', value: response ?? null, format: 'json' }],
      raw: [{ label: 'Executor 请求体', value: request ?? null, format: 'json' }],
    }));

    calls.forEach((call, index) => {
      const execution = executions[index];
      steps.push(step({
        id: `plan-executor-${executor.step}-parse-${call.id}`, group, kind: 'parse', title: `解析 ${call.function.name} 请求`,
        summary: 'Runtime 解析参数并根据 function.name 查找本地工具。', actor: 'runtime', visibility: 'observed',
        transitionReason: `Runtime 将把解析后的参数交给 ${call.function.name}。`,
        input: [{ label: '原始 arguments', value: call.function.arguments, format: 'code' }],
        output: [{ label: '解析后的参数', value: execution?.arguments ?? call.function.arguments, format: 'json' }],
      }));
      steps.push(step({
        id: `plan-executor-${executor.step}-tool-${call.id}`, group, kind: 'tool', title: `执行 ${call.function.name}`,
        summary: execution?.ok === false ? execution.error ?? '工具执行失败。' : 'Runtime 调用本地工具；模型本身不会执行工具。',
        actor: 'tool', visibility: 'observed', transitionReason: 'Runtime 将工具结果关联到 tool_call_id 并写回步骤上下文。',
        input: [{ label: '工具参数', value: execution?.arguments ?? null, format: 'json' }],
        output: [{ label: '工具结果', value: execution?.content ?? null, format: 'text' }],
      }));
    });

    if (executor.followUpRequestPayload) {
      const followUpRequest = executor.followUpRequestPayload as ApiPayload;
      const followUpResponse = executor.followUpResponsePayload as ApiPayload;
      const followUpMessage = followUpResponse?.choices?.[0]?.message;
      steps.push(step({
        id: `plan-executor-${executor.step}-append-tools`, group, kind: 'observation', title: '将工具结果写回步骤上下文',
        summary: 'Runtime 追加 Assistant 工具请求和 role=tool 结果。', actor: 'runtime', visibility: 'observed',
        transitionReason: 'Executor 需要读取工具结果，才能完成当前计划步骤。',
        stateChange: [{ label: '更新后的消息列表', value: followUpRequest.messages ?? [], format: 'json' }],
        raw: [{ label: '步骤二次请求体', value: followUpRequest, format: 'json' }],
      }));
      steps.push(step({
        id: `plan-executor-${executor.step}-follow-up-model`, group, kind: 'model', title: '根据工具结果完成步骤',
        summary: '模型基于当前步骤和工具结果生成 Step Result。', actor: 'model', visibility: 'inferred',
        transitionReason: '模型服务返回普通 Assistant 文本。',
        input: [{ label: '更新后的步骤上下文', value: followUpRequest.messages ?? [], format: 'json' }],
        output: [{ label: '生成的步骤结果', value: followUpMessage?.content ?? '', format: 'text' }],
      }));
      steps.push(step({
        id: `plan-executor-${executor.step}-follow-up-provider`, group, kind: 'provider', title: '模型服务返回步骤结果',
        summary: 'DeepSeek 返回读取工具结果后的 Assistant 响应。', actor: 'provider', visibility: 'observed',
        transitionReason: 'Runtime 提取文本并保存为当前 Step Result。',
        output: [{ label: '步骤二次 API 响应', value: followUpResponse ?? null, format: 'json' }],
      }));
    }

    steps.push(step({
      id: `plan-executor-${executor.step}-result`, group, kind: 'output', title: `保存 Step ${executor.step} Result`,
      summary: executor.stepResult || '该步骤没有返回文本结果。', actor: 'runtime', visibility: 'observed',
      transitionReason: executor.step < executorSteps.length ? 'Runtime 顺序执行计划中的下一步骤。' : '所有计划步骤已执行，Runtime 进入 Synthesizer。',
      output: [{ label: 'Step Result', value: executor.stepResult, format: 'text' }],
    }));
  });

  const synthesizerRequest = data.synthesizerRequestPayload ?? {};
  const synthesizerResponse = data.synthesizerResponsePayload ?? {};
  const synthesizerMessage = synthesizerResponse.choices?.[0]?.message;
  steps.push(step({
    id: 'plan-synthesizer-request', group: 'Synthesizer', kind: 'context', title: '汇总计划与步骤结果',
    summary: `Runtime 将原始目标、${plan.length} 个计划步骤和 ${executorSteps.length} 个执行结果写入合成上下文。`,
    actor: 'runtime', visibility: 'observed', transitionReason: 'Synthesizer 负责把分散的步骤结果整理成最终回答。',
    input: [
      { label: '执行计划', value: plan, format: 'json' },
      { label: '所有 Step Results', value: executorSteps.map((item) => item.stepResult), format: 'json' },
    ],
    output: [{ label: 'Synthesizer 请求体', value: synthesizerRequest, format: 'json' }],
  }));
  steps.push(step({
    id: 'plan-synthesizer-model', group: 'Synthesizer', kind: 'model', title: 'Synthesizer 生成最终答案',
    summary: '模型根据原始目标、完整计划和所有步骤结果生成统一回答。', actor: 'model', visibility: 'inferred',
    transitionReason: '模型服务将最终内容包装为 Chat Completion 响应。',
    input: [{ label: '合成消息', value: synthesizerRequest.messages ?? [], format: 'json' }],
    output: [{ label: '生成的最终内容', value: synthesizerMessage?.content ?? '', format: 'text' }],
  }));
  steps.push(step({
    id: 'plan-synthesizer-provider', group: 'Synthesizer', kind: 'provider', title: '模型服务返回最终响应',
    summary: 'DeepSeek 返回 Synthesizer 的 Assistant 消息。', actor: 'provider', visibility: 'observed',
    transitionReason: 'Runtime 从响应中提取最终答案。',
    output: [{ label: 'Synthesizer API 响应', value: synthesizerResponse, format: 'json' }],
  }));
  steps.push(step({
    id: 'final', group: '完成', kind: 'output', title: '展示最终回答', summary: trace.finalAnswer || '没有返回最终文本。',
    actor: 'runtime', visibility: 'observed', transitionReason: 'Planner、所有 Executor Steps 和 Synthesizer 均已完成，本次运行结束。',
    output: [{ label: '展示给用户的回答', value: trace.finalAnswer, format: 'text' }],
  }));

  return steps;
}

function legacySteps(trace: TraceRun): RuntimeStep[] {
  return [{ id: "legacy", kind: "output", title: `${trace.modeName} 运行记录`, summary: "这个模式将在后续阶段接入统一的 Runtime Step 语言。", actor: "runtime", visibility: "observed", transitionReason: "当前继续使用原有的详细检查器。", raw: [{ label: "原始 Trace", value: trace, format: "json" }] }];
}
