import OpenAI from "openai";

const directKey = process.env.OPENAI_API_KEY;
const proxyKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
const proxyBase = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;

if (!directKey && !proxyKey) {
  console.warn("[openai] WARNING: Sin OPENAI_API_KEY ni AI_INTEGRATIONS_OPENAI_API_KEY. OpenAI workspace no disponible — el servidor usará sus propias keys.");
}

export const openai = new OpenAI({
  apiKey: directKey ?? proxyKey ?? "no-key-set",
  baseURL: directKey ? undefined : proxyBase,
});
