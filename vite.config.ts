import type { IncomingMessage, ServerResponse } from "node:http";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

type ChatRequest = {
  messages?: Array<{
    role: "system" | "user" | "assistant" | "tool";
    content: string | null;
    name?: string;
    tool_call_id?: string;
    tool_calls?: Array<{
      id: string;
      type: "function";
      function: {
        name: string;
        arguments: string;
      };
    }>;
  }>;
  prompt?: string;
  temperature?: number;
  maxRounds?: number;
};

type ChatMessage = NonNullable<ChatRequest["messages"]>[number];

type ToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, unknown>;
      required?: string[];
      additionalProperties: boolean;
    };
  };
};

type ToolCall = NonNullable<ChatMessage["tool_calls"]>[number];

type ToolExecution = {
  toolCall: ToolCall;
  name: string;
  arguments: unknown;
  content: string;
  ok: boolean;
  error?: string;
};

type ReActParsedStep = {
  thought?: string;
  action?: string;
  actionInput?: unknown;
  finalAnswer?: string;
  parseError?: string;
};

type ReActStep = {
  round: number;
  assistantContent: string;
  parsed: ReActParsedStep;
  toolExecution?: ToolExecution;
  observationMessage?: ChatMessage;
  requestPayload: unknown;
  responsePayload: unknown;
};

const readBody = async (req: IncomingMessage) =>
  new Promise<string>((resolve, reject) => {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });

const sendJson = (res: ServerResponse, statusCode: number, value: unknown) => {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(value));
};

const sanitizeModelPayload = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(sanitizeModelPayload);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        key === "reasoning_content"
          ? "[redacted by AgentXRay: model reasoning is outside runtime inspection scope]"
          : sanitizeModelPayload(entry),
      ]),
    );
  }

  return value;
};

const localToolDefinitions: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "calculate",
      description:
        "Evaluate a deterministic arithmetic expression. Supports +, -, *, /, %, ^, parentheses, and decimals.",
      parameters: {
        type: "object",
        properties: {
          expression: {
            type: "string",
            description: "The arithmetic expression to evaluate, for example '(12.5 + 7) * 3'.",
          },
        },
        required: ["expression"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_current_datetime",
      description: "Get the current date and time for a requested IANA time zone.",
      parameters: {
        type: "object",
        properties: {
          timezone: {
            type: "string",
            description: "IANA time zone such as Asia/Shanghai or America/New_York.",
          },
        },
        required: [],
        additionalProperties: false,
      },
    },
  },
];

const parseJsonObject = (value: string): Record<string, unknown> => {
  const parsed = JSON.parse(value || "{}") as unknown;

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Tool arguments must be a JSON object.");
  }

  return parsed as Record<string, unknown>;
};

const evaluateMathExpression = (expression: string): number => {
  const source = expression.replace(/\s+/g, "");
  let index = 0;

  const peek = () => source[index];
  const consume = (char?: string) => {
    if (char && source[index] !== char) {
      throw new Error(`Expected "${char}" at position ${index}.`);
    }
    return source[index++];
  };

  const parseNumber = (): number => {
    const start = index;
    while (/\d|\./.test(peek() ?? "")) {
      index += 1;
    }

    const raw = source.slice(start, index);
    if (!raw || raw === "." || Number.isNaN(Number(raw))) {
      throw new Error(`Expected number at position ${start}.`);
    }

    return Number(raw);
  };

  const parsePrimary = (): number => {
    if (peek() === "+") {
      consume("+");
      return parsePrimary();
    }

    if (peek() === "-") {
      consume("-");
      return -parsePrimary();
    }

    if (peek() === "(") {
      consume("(");
      const value = parseExpression();
      consume(")");
      return value;
    }

    return parseNumber();
  };

  const parsePower = (): number => {
    let value = parsePrimary();

    if (peek() === "^") {
      consume("^");
      value = value ** parsePower();
    }

    return value;
  };

  const parseTerm = (): number => {
    let value = parsePower();

    while (peek() === "*" || peek() === "/" || peek() === "%") {
      const operator = consume();
      const right = parsePower();
      if (operator === "*") value *= right;
      if (operator === "/") value /= right;
      if (operator === "%") value %= right;
    }

    return value;
  };

  function parseExpression(): number {
    let value = parseTerm();

    while (peek() === "+" || peek() === "-") {
      const operator = consume();
      const right = parseTerm();
      if (operator === "+") value += right;
      if (operator === "-") value -= right;
    }

    return value;
  }

  if (!source) {
    throw new Error("Expression is required.");
  }

  const result = parseExpression();
  if (index !== source.length) {
    throw new Error(`Unexpected token at position ${index}.`);
  }

  if (!Number.isFinite(result)) {
    throw new Error("Expression did not produce a finite number.");
  }

  return result;
};

const executeLocalTool = (toolCall: ToolCall): ToolExecution => {
  const name = toolCall.function.name;

  try {
    const args = parseJsonObject(toolCall.function.arguments);

    if (name === "calculate") {
      const expression = args.expression;
      if (typeof expression !== "string") {
        throw new Error('Argument "expression" must be a string.');
      }

      const value = evaluateMathExpression(expression);
      return {
        toolCall,
        name,
        arguments: args,
        content: JSON.stringify({ expression, value }),
        ok: true,
      };
    }

    if (name === "get_current_datetime") {
      const timezone = typeof args.timezone === "string" ? args.timezone : "Asia/Shanghai";
      const now = new Date();
      const formatted = new Intl.DateTimeFormat("en-US", {
        dateStyle: "full",
        timeStyle: "long",
        timeZone: timezone,
      }).format(now);

      return {
        toolCall,
        name,
        arguments: args,
        content: JSON.stringify({
          timezone,
          iso: now.toISOString(),
          formatted,
        }),
        ok: true,
      };
    }

    throw new Error(`Unknown tool: ${name}.`);
  } catch (error) {
    return {
      toolCall,
      name,
      arguments: toolCall.function.arguments,
      content: JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown tool execution error.",
      }),
      ok: false,
      error: error instanceof Error ? error.message : "Unknown tool execution error.",
    };
  }
};

const createToolResultMessage = (execution: ToolExecution): ChatMessage => ({
  role: "tool",
  tool_call_id: execution.toolCall.id,
  name: execution.name,
  content: execution.content,
});

const reactToolGuide = localToolDefinitions
  .map(
    (tool) =>
      `- ${tool.function.name}: ${tool.function.description} Parameters: ${JSON.stringify(
        tool.function.parameters,
      )}`,
  )
  .join("\n");

const extractJsonObject = (value: string): string => {
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");

  if (start === -1 || end === -1 || end < start) {
    throw new Error("Action Input must contain a JSON object.");
  }

  return value.slice(start, end + 1);
};

const parseReActResponse = (content: string): ReActParsedStep => {
  const finalMatch = content.match(/Final Answer\s*:\s*([\s\S]*)/i);
  if (finalMatch?.[1]?.trim()) {
    return {
      thought: content.match(/Thought\s*:\s*([\s\S]*?)(?:Final Answer\s*:|$)/i)?.[1]?.trim(),
      finalAnswer: finalMatch[1].trim(),
    };
  }

  const actionMatch = content.match(/Action\s*:\s*([a-zA-Z0-9_-]+)/i);
  const inputMatch = content.match(/Action Input\s*:\s*([\s\S]*)/i);
  if (!actionMatch?.[1] || !inputMatch?.[1]) {
    return {
      thought: content.match(/Thought\s*:\s*([\s\S]*)/i)?.[1]?.trim(),
      parseError:
        'Expected either "Final Answer: ..." or both "Action: <tool>" and "Action Input: {...}".',
    };
  }

  try {
    return {
      thought: content.match(/Thought\s*:\s*([\s\S]*?)(?:Action\s*:|$)/i)?.[1]?.trim(),
      action: actionMatch[1].trim(),
      actionInput: JSON.parse(extractJsonObject(inputMatch[1])),
    };
  } catch (error) {
    return {
      thought: content.match(/Thought\s*:\s*([\s\S]*?)(?:Action\s*:|$)/i)?.[1]?.trim(),
      action: actionMatch[1].trim(),
      parseError: error instanceof Error ? error.message : "Could not parse Action Input.",
    };
  }
};

const createReActToolExecution = (round: number, parsed: ReActParsedStep): ToolExecution => {
  const toolCall: ToolCall = {
    id: `react-round-${round}`,
    type: "function",
    function: {
      name: parsed.action ?? "unknown",
      arguments: JSON.stringify(parsed.actionInput ?? {}),
    },
  };

  if (parsed.parseError) {
    return {
      toolCall,
      name: toolCall.function.name,
      arguments: parsed.actionInput ?? {},
      content: JSON.stringify({ error: parsed.parseError }),
      ok: false,
      error: parsed.parseError,
    };
  }

  return executeLocalTool(toolCall);
};

const createObservationMessage = (execution: ToolExecution): ChatMessage => ({
  role: "user",
  content: `Observation: ${execution.content}

Continue the ReAct loop. If the observation is enough, respond with "Final Answer: ...". Otherwise use exactly one more Action.`,
});

const finalAnswerFromContent = (content: string) =>
  content.match(/Final Answer\s*:\s*([\s\S]*)/i)?.[1]?.trim() ?? content.trim();

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const baseUrl = env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";
  const model = env.DEEPSEEK_MODEL || "deepseek-v4-pro";
  const defaultTemperature = Number(env.DEEPSEEK_TEMPERATURE ?? 0.7);

  const runChatCompletion = async (requestPayload: unknown) => {
    const upstream = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.DEEPSEEK_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestPayload),
    });
    const responseText = await upstream.text();
    const responsePayload = responseText ? sanitizeModelPayload(JSON.parse(responseText)) : null;

    return {
      ok: upstream.ok,
      status: upstream.status,
      responsePayload,
    };
  };

  return {
    plugins: [
      react(),
      {
        name: "agent-xray-deepseek-api",
        configureServer(server) {
          const readChatMessages = (body: ChatRequest): ChatMessage[] => {
            const prompt = body.prompt?.trim();

            return body.messages && body.messages.length > 0
              ? body.messages
              : prompt
                ? [
                    {
                      role: "system" as const,
                      content: "You are a helpful assistant. Respond directly to the user prompt.",
                    },
                    {
                      role: "user" as const,
                      content: prompt,
                    },
                  ]
                : [];
          };

          server.middlewares.use("/api/deepseek/chat", async (req, res, next) => {
            if (req.method !== "POST") {
              next();
              return;
            }

            if (!env.DEEPSEEK_API_KEY) {
              sendJson(res, 500, {
                error: "Missing DEEPSEEK_API_KEY. Add it to .env before running a trace.",
              });
              return;
            }

            try {
              const body = JSON.parse((await readBody(req)) || "{}") as ChatRequest;
              const messages = readChatMessages(body);

              if (messages.length === 0) {
                sendJson(res, 400, { error: "Messages or prompt are required." });
                return;
              }

              const requestPayload = {
                model,
                temperature: body.temperature ?? defaultTemperature,
                messages,
              };

              const startedAt = Date.now();
              const upstream = await runChatCompletion(requestPayload);

              if (!upstream.ok) {
                sendJson(res, upstream.status, {
                  error: "DeepSeek API request failed.",
                  requestPayload,
                  responsePayload: upstream.responsePayload,
                  status: upstream.status,
                });
                return;
              }

              sendJson(res, 200, {
                baseUrl,
                model,
                durationMs: Date.now() - startedAt,
                requestPayload,
                responsePayload: upstream.responsePayload,
              });
            } catch (error) {
              sendJson(res, 500, {
                error: error instanceof Error ? error.message : "Unknown DeepSeek proxy error.",
              });
            }
          });

          server.middlewares.use("/api/deepseek/tool-calling", async (req, res, next) => {
            if (req.method !== "POST") {
              next();
              return;
            }

            if (!env.DEEPSEEK_API_KEY) {
              sendJson(res, 500, {
                error: "Missing DEEPSEEK_API_KEY. Add it to .env before running a trace.",
              });
              return;
            }

            try {
              const body = JSON.parse((await readBody(req)) || "{}") as ChatRequest;
              const messages = readChatMessages(body);

              if (messages.length === 0) {
                sendJson(res, 400, { error: "Messages or prompt are required." });
                return;
              }

              const startedAt = Date.now();
              const requestPayload = {
                model,
                temperature: body.temperature ?? defaultTemperature,
                messages,
                tools: localToolDefinitions,
                tool_choice: "auto",
              };
              const firstCompletion = await runChatCompletion(requestPayload);

              if (!firstCompletion.ok) {
                sendJson(res, firstCompletion.status, {
                  error: "DeepSeek tool-calling request failed.",
                  requestPayload,
                  responsePayload: firstCompletion.responsePayload,
                  status: firstCompletion.status,
                });
                return;
              }

              const firstMessage = (
                firstCompletion.responsePayload as {
                  choices?: Array<{ message?: ChatMessage }>;
                } | null
              )?.choices?.[0]?.message;
              const toolCalls = firstMessage?.tool_calls ?? [];
              const toolExecutions = toolCalls.map(executeLocalTool);
              const toolResultMessages = toolExecutions.map(createToolResultMessage);
              const followUpMessages = firstMessage
                ? [...messages, firstMessage, ...toolResultMessages]
                : messages;
              const followUpRequestPayload =
                toolResultMessages.length > 0
                  ? {
                      model,
                      temperature: body.temperature ?? defaultTemperature,
                      messages: followUpMessages,
                    }
                  : null;
              const followUpCompletion = followUpRequestPayload
                ? await runChatCompletion(followUpRequestPayload)
                : null;

              if (followUpCompletion && !followUpCompletion.ok) {
                sendJson(res, followUpCompletion.status, {
                  error: "DeepSeek final answer request failed after tool execution.",
                  requestPayload,
                  responsePayload: firstCompletion.responsePayload,
                  followUpRequestPayload,
                  followUpResponsePayload: followUpCompletion.responsePayload,
                  toolDefinitions: localToolDefinitions,
                  toolExecutions,
                  status: followUpCompletion.status,
                });
                return;
              }

              sendJson(res, 200, {
                baseUrl,
                model,
                durationMs: Date.now() - startedAt,
                requestPayload,
                responsePayload: firstCompletion.responsePayload,
                toolDefinitions: localToolDefinitions,
                toolExecutions,
                followUpRequestPayload,
                followUpResponsePayload: followUpCompletion?.responsePayload ?? null,
              });
            } catch (error) {
              sendJson(res, 500, {
                error: error instanceof Error ? error.message : "Unknown DeepSeek proxy error.",
              });
            }
          });

          server.middlewares.use("/api/deepseek/react", async (req, res, next) => {
            if (req.method !== "POST") {
              next();
              return;
            }

            if (!env.DEEPSEEK_API_KEY) {
              sendJson(res, 500, {
                error: "Missing DEEPSEEK_API_KEY. Add it to .env before running a trace.",
              });
              return;
            }

            try {
              const body = JSON.parse((await readBody(req)) || "{}") as ChatRequest;
              const initialMessages = readChatMessages(body);

              if (initialMessages.length === 0) {
                sendJson(res, 400, { error: "Messages or prompt are required." });
                return;
              }

              const maxRounds = Math.max(1, Math.min(body.maxRounds ?? 4, 8));
              const startedAt = Date.now();
              const reactSteps: ReActStep[] = [];
              let loopMessages = initialMessages;
              let finalAnswer = "";
              let finalRequestPayload: unknown = null;
              let finalResponsePayload: unknown = null;

              for (let round = 1; round <= maxRounds; round += 1) {
                const requestPayload = {
                  model,
                  temperature: body.temperature ?? defaultTemperature,
                  messages: loopMessages,
                };
                const completion = await runChatCompletion(requestPayload);

                if (!completion.ok) {
                  sendJson(res, completion.status, {
                    error: "DeepSeek ReAct round request failed.",
                    requestPayload,
                    responsePayload: completion.responsePayload,
                    reactSteps,
                    status: completion.status,
                  });
                  return;
                }

                const assistantMessage = (
                  completion.responsePayload as {
                    choices?: Array<{ message?: ChatMessage }>;
                  } | null
                )?.choices?.[0]?.message;
                const assistantContent = assistantMessage?.content ?? "";
                const parsed = parseReActResponse(assistantContent);
                const step: ReActStep = {
                  round,
                  assistantContent,
                  parsed,
                  requestPayload,
                  responsePayload: completion.responsePayload,
                };

                reactSteps.push(step);

                if (parsed.finalAnswer) {
                  finalAnswer = parsed.finalAnswer;
                  finalResponsePayload = completion.responsePayload;
                  break;
                }

                const toolExecution = createReActToolExecution(round, parsed);
                const observationMessage = createObservationMessage(toolExecution);
                step.toolExecution = toolExecution;
                step.observationMessage = observationMessage;
                loopMessages = [
                  ...loopMessages,
                  { role: "assistant", content: assistantContent },
                  observationMessage,
                ];
              }

              if (!finalAnswer) {
                finalRequestPayload = {
                  model,
                  temperature: body.temperature ?? defaultTemperature,
                  messages: [
                    ...loopMessages,
                    {
                      role: "user" as const,
                      content:
                        "Max ReAct rounds reached. Produce the best concise response now using the observations. Start with Final Answer:",
                    },
                  ],
                };
                const finalCompletion = await runChatCompletion(finalRequestPayload);

                if (!finalCompletion.ok) {
                  sendJson(res, finalCompletion.status, {
                    error: "DeepSeek ReAct final answer request failed.",
                    reactSteps,
                    finalRequestPayload,
                    finalResponsePayload: finalCompletion.responsePayload,
                    status: finalCompletion.status,
                  });
                  return;
                }

                finalResponsePayload = finalCompletion.responsePayload;
                const finalContent =
                  (
                    finalCompletion.responsePayload as {
                      choices?: Array<{ message?: { content?: string | null } }>;
                    } | null
                  )?.choices?.[0]?.message?.content ?? "";
                finalAnswer = finalAnswerFromContent(finalContent);
              }

              sendJson(res, 200, {
                baseUrl,
                model,
                durationMs: Date.now() - startedAt,
                requestPayload: reactSteps[0]?.requestPayload ?? null,
                responsePayload: reactSteps[0]?.responsePayload ?? null,
                toolDefinitions: localToolDefinitions,
                reactToolGuide,
                reactSteps,
                finalRequestPayload,
                finalResponsePayload,
                finalAnswer,
                maxRounds,
              });
            } catch (error) {
              sendJson(res, 500, {
                error: error instanceof Error ? error.message : "Unknown DeepSeek proxy error.",
              });
            }
          });
        },
      },
    ],
    server: {
      host: "127.0.0.1",
      port: 5173,
    },
  };
});
