// Starts self-hosted Hindsight in Docker, reusing the LLM settings from server/.env
// so the API key lives in one place. The key is passed via the environment and never printed.
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const env = Object.fromEntries(
  readFileSync(new URL("../server/.env", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
);

if (!env.LLM_API_KEY) {
  console.error("Set LLM_API_KEY in server/.env first.");
  process.exit(1);
}
const provider = env.HINDSIGHT_LLM_PROVIDER || (/groq\.com/.test(env.LLM_BASE_URL ?? "groq.com") ? "groq" : "openai");
// Groq rate limits are per model. Giving Hindsight its own model keeps its extraction/reflect
// traffic from competing with the app's analysis calls for the same tokens-per-minute budget.
const model = env.HINDSIGHT_LLM_MODEL || (provider === "groq" ? "openai/gpt-oss-20b" : env.LLM_MODEL || "gpt-4o-mini");

spawnSync("docker", ["rm", "-f", "revenueos-hindsight"], { stdio: "ignore" });
const r = spawnSync(
  "docker",
  [
    "run", "-d", "--name", "revenueos-hindsight", "--restart", "unless-stopped", "--shm-size=1g",
    "-p", "8888:8888", "-p", "9999:9999",
    "-e", "HINDSIGHT_API_LLM_PROVIDER",
    "-e", "HINDSIGHT_API_LLM_API_KEY",
    "-e", "HINDSIGHT_API_LLM_MODEL",
    // Groq's free plan rejects service_tier=auto (Hindsight's default); on_demand works on every plan.
    "-e", "HINDSIGHT_API_LLM_GROQ_SERVICE_TIER=on_demand",
    "-v", "revenueos-hindsight:/home/hindsight/.pg0",
    "ghcr.io/vectorize-io/hindsight:latest",
  ],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      HINDSIGHT_API_LLM_PROVIDER: provider,
      HINDSIGHT_API_LLM_API_KEY: env.LLM_API_KEY,
      HINDSIGHT_API_LLM_MODEL: model,
    },
  }
);
if (r.status === 0) console.log(`Hindsight starting (provider=${provider}, model=${model}). API http://localhost:8888, UI http://localhost:9999`);
process.exit(r.status ?? 1);
