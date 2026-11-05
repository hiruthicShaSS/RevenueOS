import OpenAI from "openai";
import { z } from "zod";
import { config } from "./config.js";

// maxRetries: the SDK backs off on 429/5xx and honours Groq's retry-after header.
const client = new OpenAI({ baseURL: config.llm.baseUrl, apiKey: config.llm.apiKey || "missing", maxRetries: 4, timeout: 90_000 });

export class LlmError extends Error {}

/**
 * Ask the LLM for JSON matching `schema`.
 *
 * Open models on Groq occasionally return malformed JSON or drift from the
 * requested shape, so every call is validated with zod. On failure we retry
 * once with the validation error fed back, then once more on the fallback model.
 */
export async function llmJson<T extends z.ZodTypeAny>(opts: {
  system: string;
  user: string;
  schema: T;
  temperature?: number;
}): Promise<z.infer<T>> {
  if (!config.llm.apiKey) throw new LlmError("LLM_API_KEY is not set. Add it to server/.env.");

  const models = [config.llm.model, config.llm.model, config.llm.fallbackModel].filter(Boolean);
  let feedback = "";
  let lastErr: unknown;

  for (const model of models) {
    try {
      const res = await client.chat.completions.create({
        model,
        temperature: opts.temperature ?? 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: `${opts.system}\n\nRespond with a single JSON object only. No prose, no markdown fences.` },
          { role: "user", content: opts.user + feedback },
        ],
      });
      const raw = res.choices[0]?.message?.content ?? "";
      const parsed = opts.schema.safeParse(JSON.parse(stripFences(raw)));
      if (parsed.success) return parsed.data;
      lastErr = parsed.error;
      feedback = `\n\nYour previous answer did not match the required shape: ${parsed.error.issues
        .slice(0, 5)
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}. Return corrected JSON.`;
    } catch (e) {
      lastErr = e;
      feedback = `\n\nYour previous answer was not valid JSON. Return one valid JSON object.`;
    }
  }
  throw new LlmError(`LLM did not return valid JSON after retries: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
}

function stripFences(s: string) {
  return s.replace(/^\s*```(?:json)?/i, "").replace(/```\s*$/, "").trim();
}
