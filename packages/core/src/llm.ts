/**
 * Lightweight LLM client using native fetch, compatible with OpenAI-compatible APIs.
 * Avoids issues with the OpenAI SDK's internal connection pooling in certain environments.
 */

export interface ChatCompletionMessageParam {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMClient {
  apiKey: string;
  baseUrl: string;
}

export function createLLMClient(apiKey: string, baseUrl?: string): LLMClient {
  const normalizedBase = (baseUrl || "https://api.openai.com").replace(/\/+$/, "");
  return {
    apiKey: apiKey || "",
    baseUrl: normalizedBase,
  };
}

/**
 * Call a chat completions endpoint expecting a JSON response.
 * Uses native fetch with an AbortController timeout.
 */
export async function chatJSON(
  client: LLMClient,
  model: string,
  messages: ChatCompletionMessageParam[],
  temperature = 0,
  timeoutMs = 180_000,
): Promise<string> {
  const url = `${client.baseUrl}/v1/chat/completions`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${client.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        response_format: { type: "json_object" },
        temperature,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      throw new Error(`LLM API error (${res.status}): ${errBody.slice(0, 300)}`);
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return data.choices?.[0]?.message?.content ?? "";
  } finally {
    clearTimeout(timer);
  }
}
