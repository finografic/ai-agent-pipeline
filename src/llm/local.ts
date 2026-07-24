export interface OllamaChatParams {
  baseUrl: string;
  model: string;
  systemPrompt?: string;
  userPrompt: string;
  json: boolean;
}

export interface OllamaChatResult {
  content: string;
  promptTokens: number | null;
  completionTokens: number | null;
}

interface OllamaChatResponse {
  message: { content: string };
  prompt_eval_count?: number;
  eval_count?: number;
}

/** Minimal Ollama chat client — one call, optional JSON mode, real token counts when reported. */
export async function ollamaChat({
  baseUrl,
  model,
  systemPrompt,
  userPrompt,
  json,
}: OllamaChatParams): Promise<OllamaChatResult> {
  const messages = systemPrompt !== undefined ? [{ role: 'system', content: systemPrompt }] : [];
  messages.push({ role: 'user', content: userPrompt });

  const response = await fetch(new URL('/api/chat', baseUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, messages, stream: false, ...(json ? { format: 'json' } : {}) }),
  });

  if (!response.ok) {
    throw new Error(`Ollama chat request failed (${response.status}): ${await response.text()}`);
  }

  const data = (await response.json()) as OllamaChatResponse;
  return {
    content: data.message.content,
    promptTokens: data.prompt_eval_count ?? null,
    completionTokens: data.eval_count ?? null,
  };
}
