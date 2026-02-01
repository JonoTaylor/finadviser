import Anthropic from '@anthropic-ai/sdk';
import { SYSTEM_PROMPT, CATEGORIZATION_PROMPT, AGENT_SYSTEM_PROMPT } from './prompts';
import { TOOL_DEFINITIONS, TOOL_LABELS, executeTool } from './tools';

const MODEL = 'claude-sonnet-4-20250514';

export type AgentEvent =
  | { type: 'tool'; name: string; label: string }
  | { type: 'text'; content: string };

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

/**
 * Run the agentic loop with streaming: Claude can call tools, we execute
 * them and loop until Claude produces a final text response.
 *
 * Uses streaming API calls so text is delivered incrementally and
 * long-running tool loops don't cause idle-connection timeouts.
 */
export async function* runAgent(
  userMessage: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }> = [],
): AsyncGenerator<AgentEvent, string> {
  const client = getClient();
  const MAX_ITERATIONS = 15;

  // Build messages for the API. History entries are simple text,
  // the agent loop may add structured content blocks.
  const messages: Anthropic.Messages.MessageParam[] = history.map((m) => ({
    role: m.role,
    content: m.content,
  }));
  messages.push({ role: 'user', content: userMessage });

  let fullResponse = '';

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 4096,
      system: AGENT_SYSTEM_PROMPT,
      tools: TOOL_DEFINITIONS,
      messages,
    });

    // Stream text deltas for real-time display
    for await (const event of stream) {
      if (
        event.type === 'content_block_delta' &&
        event.delta.type === 'text_delta'
      ) {
        fullResponse += event.delta.text;
        yield { type: 'text', content: event.delta.text };
      }
    }

    const response = await stream.finalMessage();

    // If Claude wants to use tools, execute them and continue the loop
    if (response.stop_reason === 'tool_use') {
      messages.push({ role: 'assistant', content: response.content });

      const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type === 'tool_use') {
          yield { type: 'tool', name: block.name, label: TOOL_LABELS[block.name] ?? block.name };
          const result = await executeTool(block.name, block.input as Record<string, unknown>);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify(result),
          });
        }
      }
      messages.push({ role: 'user', content: toolResults });
      continue;
    }

    // Final text response — text was already streamed above
    break;
  }

  if (!fullResponse) {
    const fallback = 'I had trouble processing your request. Please try again or rephrase your question.';
    yield { type: 'text', content: fallback };
    fullResponse = fallback;
  }

  return fullResponse;
}
