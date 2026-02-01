import Anthropic from '@anthropic-ai/sdk';
import { SYSTEM_PROMPT, CATEGORIZATION_PROMPT } from './prompts';

const MODEL = 'claude-sonnet-4-20250514';

function getClient() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
}

export async function* streamChat(
  userMessage: string,
  financialContext: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }> = [],
): AsyncGenerator<string> {
  const client = getClient();

  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [...history];

  let content = userMessage;
  if (financialContext) {
    content = `${userMessage}\n\n--- Financial Data Context ---\n${financialContext}`;
  }
  messages.push({ role: 'user', content });

  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages,
  });

  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      yield event.delta.text;
    }
  }
}

export async function chat(
  userMessage: string,
  financialContext: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }> = [],
): Promise<string> {
  let result = '';
  for await (const chunk of streamChat(userMessage, financialContext, history)) {
    result += chunk;
  }
  return result;
}

export async function categorizeBatch(
  descriptions: string[],
  availableCategories: string[],
): Promise<Record<string, string>> {
  const client = getClient();

  const prompt = CATEGORIZATION_PROMPT
    .replace('{categories}', availableCategories.map(c => `- ${c}`).join('\n'))
    .replace('{transactions}', descriptions.map(d => `- ${d}`).join('\n'));

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: 'You are a financial transaction categorizer. Respond only with valid JSON.',
    messages: [{ role: 'user', content: prompt }],
  });

  try {
    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const result = JSON.parse(text);
    return typeof result === 'object' && result !== null ? result : {};
  } catch {
    return {};
  }
}
