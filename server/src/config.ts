import "dotenv/config";
import path from "node:path";

function env(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v === undefined || v === "") {
    if (fallback !== undefined) return fallback;
    return "";
  }
  return v;
}

export const config = {
  port: Number(env("PORT", "4000")),

  /** "hindsight" (default) uses the real Hindsight API. "mock" is for offline UI work only. */
  memoryMode: env("MEMORY_MODE", "hindsight") as "hindsight" | "mock",
  hindsight: {
    baseUrl: env("HINDSIGHT_BASE_URL", "http://localhost:8888"),
    apiKey: env("HINDSIGHT_API_KEY") || undefined,
    bankPrefix: env("HINDSIGHT_BANK_PREFIX", "revenueos"),
  },

  /** Any OpenAI-compatible endpoint. Defaults to Groq. */
  llm: {
    baseUrl: env("LLM_BASE_URL", "https://api.groq.com/openai/v1"),
    apiKey: env("LLM_API_KEY"),
    model: env("LLM_MODEL", "openai/gpt-oss-120b"),
    fallbackModel: env("LLM_FALLBACK_MODEL", "qwen/qwen3.8-27b"),
  },

  /** Postgres connection string. Empty = embedded Postgres (PGlite) persisted to dataDir. */
  databaseUrl: env("DATABASE_URL"),
  dataDir: path.resolve(env("DATA_DIR", path.join(process.cwd(), "data", "pg"))),
};

export type Config = typeof config;
