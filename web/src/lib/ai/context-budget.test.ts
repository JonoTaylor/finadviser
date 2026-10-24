import { describe, expect, it } from 'vitest';
import type { ModelMessage } from 'ai';
import { boundAdviserHistory, boundAdviserModelMessages } from './context-budget';

describe('bounded adviser context', () => {
  it('keeps recent context and interruption notices while leaving saved history untouched', () => {
    const history = Array.from({ length: 20 }, (_, index) => ({ role: index % 2 ? 'assistant' as const : 'user' as const,
      content: `Message ${index}: ` + 'large financial review '.repeat(5000) + '\nReview interrupted. Verify current records.',
    }));
    const result = boundAdviserHistory(history);
    expect(result.reduce((total, message) => total + message.content.length, 0)).toBeLessThanOrEqual(36_000);
    expect(result.at(-1)?.content).toContain('Message 19');
    expect(result.at(-1)?.content).toContain('Review interrupted. Verify current records.');
    expect(result.at(-1)?.content).toContain('Omitted details are unknown');
    expect(result[0].content).not.toContain('Message 0:');
    expect(history[19].content.length).toBeGreaterThan(100_000);
  });
  it('preserves complete small history without inventing earlier messages', () => {
    const history = [{ role: 'user' as const, content: 'What is missing from my pension profile?' }];
    expect(boundAdviserHistory(history)).toEqual(history);
  });
  it('keeps tool calls paired with bounded explicitly incomplete results and preserves the latest question', () => {
    const question = { role: 'user' as const, content: 'Review my spending; do not change my records.' };
    const messages: ModelMessage[] = [question, {
      role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'read-1', toolName: 'search_transactions', input: { limit: 100 } }],
    }, { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'read-1', toolName: 'search_transactions', output: {
      type: 'json', value: { entries: Array.from({ length: 100 }, () => ({ description: 'Long imported statement details '.repeat(200), amount: '-10.00' })) },
    } }] }];
    const result = boundAdviserModelMessages(messages);
    expect(result[0]).toEqual(question);
    expect(result[1]).toEqual(messages[1]);
    const tool = result[2];
    expect(tool.role).toBe('tool');
    if (tool.role !== 'tool') throw new Error('Tool result missing');
    expect(tool.content[0]).toMatchObject({ toolCallId: 'read-1', toolName: 'search_transactions', output: {
      type: 'json', value: { status: 'partial', truncated: true },
    } });
    expect(JSON.stringify(tool)).toContain('must not justify repeating a write');
    expect(JSON.stringify(tool).length).toBeLessThan(12_500);
    expect(JSON.stringify(messages[2]).length).toBeGreaterThan(100_000);
  });
  it('preserves exact financial action outcomes when they fit within context', () => {
    const messages: ModelMessage[] = [{ role: 'tool', content: [{ type: 'tool-result', toolCallId: 'save-1', toolName: 'auto_categorize',
      output: { type: 'json', value: { ruleBased: 5, aiCategorized: 3, conflicts: 1, hasMore: true } },
    }] }];
    expect(boundAdviserModelMessages(messages)).toEqual(messages);
  });
});
