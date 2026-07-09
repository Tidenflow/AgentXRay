import type { IncomingMessage, ServerResponse } from "node:http";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

type ChatRequest = {
  messages?: Array<{
    role: "system" | "user" | "assistant" | "tool";
    content: string | null;
  }>;
  prompt?: string;
  temperature?: number;
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

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const baseUrl = env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";
  const model = env.DEEPSEEK_MODEL || "deepseek-v4-pro";
  const defaultTemperature = Number(env.DEEPSEEK_TEMPERATURE ?? 0.7);

  return {
    plugins: [
      react(),
      {
        name: "agent-xray-deepseek-api",
        configureServer(server) {
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
              const prompt = body.prompt?.trim();
              const messages =
                body.messages && body.messages.length > 0
                  ? body.messages
                  : prompt
                    ? [
                        {
                          role: "system" as const,
                          content:
                            "You are a helpful assistant. Respond directly to the user prompt.",
                        },
                        {
                          role: "user" as const,
                          content: prompt,
                        },
                      ]
                    : [];

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
              const upstream = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${env.DEEPSEEK_API_KEY}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify(requestPayload),
              });
              const responseText = await upstream.text();
              const responsePayload = responseText
                ? sanitizeModelPayload(JSON.parse(responseText))
                : null;

              if (!upstream.ok) {
                sendJson(res, upstream.status, {
                  error: "DeepSeek API request failed.",
                  requestPayload,
                  responsePayload,
                  status: upstream.status,
                });
                return;
              }

              sendJson(res, 200, {
                baseUrl,
                model,
                durationMs: Date.now() - startedAt,
                requestPayload,
                responsePayload,
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
