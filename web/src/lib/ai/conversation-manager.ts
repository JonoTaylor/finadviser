import { conversationRepo } from '@/lib/repos';
import { ClientError, NotFoundError } from '@/lib/errors';
import type { AdviserMessageMetadata } from './specialists/contracts';

const MAX_HISTORY_MESSAGES = 20;

export async function getOrCreateConversation(conversationId?: number | null, title?: string) {
  if (conversationId != null) {
    if (!Number.isInteger(conversationId) || conversationId < 1 || conversationId > 2147483647) throw new ClientError('Use a valid conversation ID.');
    if (!await conversationRepo.getConversationById(conversationId)) throw new NotFoundError('This conversation was not found. Start a new conversation before sending.');
    return conversationId;
  }
  const conv = await conversationRepo.createConversation(title ?? null);
  return conv.id;
}

export async function addUserMessage(conversationId: number, content: string) {
  return conversationRepo.addMessage(conversationId, 'user', content);
}

export async function addAssistantMessage(conversationId: number, content: string, metadata?: AdviserMessageMetadata | null) {
  return metadata === undefined
    ? conversationRepo.addMessage(conversationId, 'assistant', content)
    : conversationRepo.addMessage(conversationId, 'assistant', content, metadata);
}

export async function getHistory(conversationId: number): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> {
  return conversationRepo.getModelHistory(conversationId, MAX_HISTORY_MESSAGES);
}

export async function listConversations() {
  return conversationRepo.listConversations();
}
