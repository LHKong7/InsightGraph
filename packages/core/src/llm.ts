import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

export function createLLMClient(apiKey: string, baseUrl?: string): OpenAI {
  return new OpenAI({
    apiKey: apiKey || "dummy",
    ...(baseUrl ? { baseURL: baseUrl } : {}),
  });
}

export async function chatJSON(
  client: OpenAI,
  model: string,
  messages: ChatCompletionMessageParam[],
  temperature = 0,
): Promise<string> {
  const res = await client.chat.completions.create({
    model,
    messages,
    response_format: { type: "json_object" },
    temperature,
  });
  return res.choices[0].message.content ?? "";
}

export type { ChatCompletionMessageParam };
