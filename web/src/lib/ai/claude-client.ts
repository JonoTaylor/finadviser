import { streamText, generateText, jsonSchema, stepCountIs, tool } from 'ai';
import { gateway } from '@ai-sdk/gateway';
import type { ModelMessage, ToolSet } from 'ai';
import { SYSTEM_PROMPT, CATEGORIZATION_PROMPT, AGENT_SYSTEM_PROMPT } from './prompts';
import { TOOL_DEFINITIONS, TOOL_LABELS, executeTool } from './tools';

/**
 * AI client backed by Vercel AI Gateway.
 *
 * The previous version called the Anthropic SDK directly with a hard-coded
 * Claude model. Routing through the gateway means we can change the model
 * — or fall back to a different provider — without code changes (set
 * `MODEL_ID` in Vercel env to e.g. 'openai/gpt-5' or 'anthropic/
 * claude-sonnet-4-6'). The gateway handles auth via AI_GATEWAY_API_KEY.
 *
 * Public surface (streamChat / chat / categorizeBatch / runAgent) is
 * unchanged so existing callsites need no edits.
 */

const DEFAULT_MODEL_ID = 'anthropic/claude-sonnet-4-5';

function model() {
  // gateway() returns a LanguageModel for the given 'provider/model' id.
  return gateway(process.env.MODEL_ID ?? DEFAULT_MODEL_ID);
}

export type AgentEvent =
  | { type: 'tool'; name: string; label: string }
  | { type: 'text'; content: string };

export async function* streamChat(
  userMessage: string,
  financialContext: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }> = [],
): AsyncGenerator<string> {
  let userContent = userMessage;
  if (financialContext) {
    userContent = `${userMessage}\n\n--- Financial Data Context ---\n${financialContext}`;
  }

  const messages: ModelMessage[] = [
    ...history.map((m) => ({ role: m.role, content: m.content }) as ModelMessage),
    { role: 'user', content: userContent },
  ];

  const result = streamText({
    model: model(),
    system: SYSTEM_PROMPT,
    messages,
    maxOutputTokens: 4096,
  });

  for await (const chunk of result.textStream) {
    yield chunk;
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
  const prompt = CATEGORIZATION_PROMPT
    .replace('{categories}', availableCategories.map((c) => `- ${c}`).join('\n'))
    .replace('{transactions}', descriptions.map((d) => `- ${d}`).join('\n'));

  const { text } = await generateText({
    model: model(),
    system: 'You are a financial transaction categorizer. Respond only with valid JSON.',
    prompt,
    maxOutputTokens: 2048,
  });

  // Strict parse, then a best-effort markdown-fenced extract, then warn.
  // We don't use generateObject because the response shape has arbitrary
  // string keys (transaction descriptions) which makes a Zod schema awkward.
  try {
    const parsed = JSON.parse(text);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, string>)
      : {};
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        const parsed = JSON.parse(match[0]);
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
          return parsed as Record<string, string>;
        }
      } catch {
        // fall through
      }
    }
    console.warn('[categorizeBatch] AI returned non-JSON response, returning empty result.', {
      excerpt: text.slice(0, 200),
    });
    return {};
  }
}

/**
 * Adapt the existing TOOL_DEFINITIONS (Anthropic-style JSON Schema) into
 * the AI SDK's tool() helpers. We keep TOOL_DEFINITIONS + executeTool as
 * the single source of truth for tool implementations; this just bridges
 * the calling convention.
 *
 * The double-cast is the cleanest way to bridge our `Record<string, unknown>`
 * properties shape to AI SDK's strict JSONSchema7 type — the schema is
 * structurally correct but the looser type is more practical to author.
 */
function buildAgentTools(): ToolSet {
  const tools: ToolSet = {};
  for (const def of TOOL_DEFINITIONS) {
    tools[def.name] = tool({
      description: def.description,
      inputSchema: jsonSchema(def.input_schema as Parameters<typeof jsonSchema>[0]),
      execute: async (input: unknown) =>
        executeTool(def.name, (input ?? {}) as Record<string, unknown>),
    });
  }
  return tools;
}

/**
 * Run the agentic loop: the model can call tools, the SDK executes them
 * and continues until the model produces a final text response or hits
 * the step cap.
 *
 * Yields AgentEvents (tool-call announcements + text deltas) so the chat
 * page can show "Calling tool X…" status alongside streamed reply text.
 * Returns the final concatenated text so callers can persist it.
 */
export async function* runAgent(
  userMessage: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }> = [],
): AsyncGenerator<AgentEvent, string> {
  const messages: ModelMessage[] = [
    ...history.map((m) => ({ role: m.role, content: m.content }) as ModelMessage),
    { role: 'user', content: userMessage },
  ];

  const result = streamText({
    model: model(),
    system: AGENT_SYSTEM_PROMPT,
    messages,
    tools: buildAgentTools(),
    // Match the previous 15-iteration cap.
    stopWhen: stepCountIs(15),
    maxOutputTokens: 4096,
  });

  let fullText = '';
  for await (const part of result.fullStream) {
    switch (part.type) {
      case 'text-delta': {
        const delta = part.text ?? '';
        fullText += delta;
        if (delta) yield { type: 'text', content: delta };
        break;
      }
      case 'tool-call': {
        const name = part.toolName;
        yield { type: 'tool', name, label: TOOL_LABELS[name] ?? name };
        break;
      }
      // tool-result / step-start / step-finish / finish / reasoning etc.
      // are not surfaced to callers — we only need text + tool-call events
      // to render the existing UI.
      default:
        break;
    }
  }

  if (!fullText) {
    const fallback = 'I had trouble processing your request. Please try again or rephrase your question.';
    yield { type: 'text', content: fallback };
    fullText = fallback;
  }

  return fullText;
}
