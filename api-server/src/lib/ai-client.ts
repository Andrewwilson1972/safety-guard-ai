/**
 * Flexible AI client — supports two backends:
 *  - Ollama  (fully offline/self-hosted, free)
 *  - OpenAI  (cloud, requires OPENAI_API_KEY)
 *
 * Detection order:
 *  1. OLLAMA_BASE_URL is set  → use Ollama (offline mode)
 *  2. OPENAI_API_KEY is set   → use OpenAI (cloud mode)
 *  3. Neither                 → throw a helpful configuration error
 */

import OpenAI from "openai";

export type AiMode = "openai" | "ollama";

function createClient(): { client: OpenAI; mode: AiMode; model: string } {
  const ollamaBase = process.env.OLLAMA_BASE_URL;
  const openaiBase =
    process.env.OPENAI_BASE_URL ?? process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  const openaiKey =
    process.env.OPENAI_API_KEY ?? process.env.AI_INTEGRATIONS_OPENAI_API_KEY;

  if (ollamaBase) {
    const client = new OpenAI({
      baseURL: ollamaBase.replace(/\/$/, "") + "/v1",
      apiKey: "ollama",
    });
    const model = process.env.OLLAMA_MODEL ?? "llama3";
    return { client, mode: "ollama", model };
  }

  if (openaiBase && openaiKey) {
    const client = new OpenAI({ baseURL: openaiBase, apiKey: openaiKey });
    const model = process.env.OPENAI_MODEL ?? "gpt-4o";
    return { client, mode: "openai", model };
  }

  throw new Error(
    "No AI backend configured. " +
      "Set OLLAMA_BASE_URL=http://localhost:11434 for offline/local mode, " +
      "or set OPENAI_API_KEY (and optionally OPENAI_BASE_URL) for cloud mode."
  );
}

let _instance: ReturnType<typeof createClient> | null = null;

function getInstance() {
  if (!_instance) _instance = createClient();
  return _instance;
}

export function getAiClient() {
  return getInstance().client;
}

export function getAiModel() {
  return getInstance().model;
}

export function getAiMode(): AiMode {
  return getInstance().mode;
}

export function isAiAvailable(): boolean {
  try {
    getInstance();
    return true;
  } catch {
    return false;
  }
}
