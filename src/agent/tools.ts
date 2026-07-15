import type { ChatMessage, ToolCall, ToolDefinition, ToolExecution } from "./types";

export const localToolDefinitions: ToolDefinition[] = [
  { type: "function", function: { name: "calculate", description: "Evaluate a deterministic arithmetic expression. Supports +, -, *, /, %, ^, parentheses, and decimals.", parameters: { type: "object", properties: { expression: { type: "string", description: "The arithmetic expression to evaluate, for example '(12.5 + 7) * 3'." } }, required: ["expression"], additionalProperties: false } } },
  { type: "function", function: { name: "get_current_datetime", description: "Get the current date and time for a requested IANA time zone.", parameters: { type: "object", properties: { timezone: { type: "string", description: "IANA time zone such as Asia/Shanghai or America/New_York." } }, additionalProperties: false } } },
];

export const parseJsonObject = (value: string): Record<string, unknown> => {
  const parsed: unknown = JSON.parse(value || "{}");
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Tool arguments must be a JSON object.");
  return parsed as Record<string, unknown>;
};

export const evaluateMathExpression = (expression: string): number => {
  const source = expression.replace(/\s+/g, ""); let index = 0;
  const peek = () => source[index];
  const consume = (char?: string) => { if (char && source[index] !== char) throw new Error(`Expected "${char}" at position ${index}.`); return source[index++]; };
  const parseNumber = (): number => { const start = index; while (/\d|\./.test(peek() ?? "")) index += 1; const raw = source.slice(start, index); if (!raw || raw === "." || Number.isNaN(Number(raw))) throw new Error(`Expected number at position ${start}.`); return Number(raw); };
  const parsePrimary = (): number => { if (peek() === "+") { consume("+"); return parsePrimary(); } if (peek() === "-") { consume("-"); return -parsePrimary(); } if (peek() === "(") { consume("("); const value = parseExpression(); consume(")"); return value; } return parseNumber(); };
  const parsePower = (): number => { let value = parsePrimary(); if (peek() === "^") { consume("^"); value **= parsePower(); } return value; };
  const parseTerm = (): number => { let value = parsePower(); while (["*", "/", "%"].includes(peek())) { const op = consume(); const right = parsePower(); if (op === "*") value *= right; if (op === "/") value /= right; if (op === "%") value %= right; } return value; };
  function parseExpression(): number { let value = parseTerm(); while (["+", "-"].includes(peek())) { const op = consume(); const right = parseTerm(); if (op === "+") value += right; else value -= right; } return value; }
  if (!source) throw new Error("Expression is required."); const result = parseExpression();
  if (index !== source.length) throw new Error(`Unexpected token at position ${index}.`);
  if (!Number.isFinite(result)) throw new Error("Expression did not produce a finite number."); return result;
};

export const executeLocalTool = (toolCall: ToolCall): ToolExecution => {
  const name = toolCall.function.name;
  try {
    const args = parseJsonObject(toolCall.function.arguments);
    if (name === "calculate") { if (typeof args.expression !== "string") throw new Error('Argument "expression" must be a string.'); const value = evaluateMathExpression(args.expression); return { toolCall, name, arguments: args, content: JSON.stringify({ expression: args.expression, value }), ok: true }; }
    if (name === "get_current_datetime") { const timezone = typeof args.timezone === "string" ? args.timezone : "Asia/Shanghai"; const now = new Date(); const formatted = new Intl.DateTimeFormat("en-US", { dateStyle: "full", timeStyle: "long", timeZone: timezone }).format(now); return { toolCall, name, arguments: args, content: JSON.stringify({ timezone, iso: now.toISOString(), formatted }), ok: true }; }
    throw new Error(`Unknown tool: ${name}.`);
  } catch (error) { const message = error instanceof Error ? error.message : "Unknown tool execution error."; return { toolCall, name, arguments: toolCall.function.arguments, content: JSON.stringify({ error: message }), ok: false, error: message }; }
};

export const createToolResultMessage = (execution: ToolExecution): ChatMessage => ({ role: "tool", tool_call_id: execution.toolCall.id, name: execution.name, content: execution.content });
