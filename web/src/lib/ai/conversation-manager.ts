import { conversationRepo } from '@/lib/repos';

const MAX_HISTORY_MESSAGES = 20;

export async function getOrCreateConversation(conversationId?: number | null, title?: string) {
  if (conversationId) {
    return conversationId;
  }
  const conv = await conversationRepo.createConversation(title ?? null);
  return conv.id;
}

export async function addUserMessage(conversationId: number, content: string) {
  return conversationRepo.addMessage(conversationId, 'user', content);
}

export async function addAssistantMessage(conversationId: number, content: string) {
  return conversationRepo.addMessage(conversationId, 'assistant', content);
}

export async function getHistory(conversationId: number): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> {
  const messages = await conversationRepo.getMessages(conversationId);

  const filtered = messages
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

  if (filtered.length > MAX_HISTORY_MESSAGES) {
    return filtered.slice(-MAX_HISTORY_MESSAGES);
  }
  return filtered;
}

export async function listConversations() {
  return conversationRepo.listConversations();
}
