import OpenAI from "openai";

const directKey = process.env.OPENAI_API_KEY;
const proxyKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
const proxyBase = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;

if (!directKey && !proxyKey) {
  throw new Error(
    "Set OPENAI_API_KEY (direct OpenAI) or AI_INTEGRATIONS_OPENAI_API_KEY (Replit proxy).",
  );
}

export const openai = new OpenAI({
  apiKey: directKey ?? proxyKey!,
  baseURL: directKey ? undefined : proxyBase,
});
