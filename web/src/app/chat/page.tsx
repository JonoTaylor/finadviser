'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Box, Typography, TextField, IconButton, Button, Stack,
  List, ListItemButton, ListItemText, Paper, Divider, Drawer,
  CircularProgress,
} from '@mui/material';
import SendIcon from '@mui/icons-material/Send';
import AddIcon from '@mui/icons-material/Add';
import useSWR from 'swr';
import ReactMarkdown from 'react-markdown';

const fetcher = (url: string) => fetch(url).then(r => r.json());

const QUICK_PROMPTS = [
  { label: 'Spending Summary', prompt: 'Give me a spending summary for the last few months' },
  { label: 'Budget Check', prompt: 'Analyze my budget and suggest improvements' },
  { label: 'Property Report', prompt: 'Generate a property equity report' },
  { label: 'Net Worth', prompt: 'Analyze my net worth and financial health' },
];

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export default function ChatPage() {
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const { data: conversations, mutate: mutateConversations } = useSWR('/api/chat/conversations', fetcher);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(scrollToBottom, [messages, streamingContent]);

  const loadConversation = useCallback(async (id: number) => {
    const res = await fetch(`/api/chat/conversations/${id}`);
    const msgs = await res.json();
    setConversationId(id);
    setMessages(msgs.map((m: { role: string; content: string }) => ({ role: m.role, content: m.content })).filter((m: Message) => m.role === 'user' || m.role === 'assistant'));
    setSidebarOpen(false);
  }, []);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || loading) return;

    const userMsg: Message = { role: 'user', content: text };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);
    setStreamingContent('');

    try {
      const res = await fetch('/api/ai/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          conversationId,
        }),
      });

      if (!res.ok) throw new Error('AI request failed');

      const reader = res.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let fullContent = '';
      let firstChunk = true;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });

        if (firstChunk) {
          // First chunk might contain conversation ID JSON
          const newlineIdx = chunk.indexOf('\n');
          if (newlineIdx > -1) {
            try {
              const meta = JSON.parse(chunk.substring(0, newlineIdx));
              if (meta.conversationId) {
                setConversationId(meta.conversationId);
              }
            } catch { /* not JSON, treat as content */ }
            fullContent += chunk.substring(newlineIdx + 1);
          } else {
            try {
              const meta = JSON.parse(chunk);
              if (meta.conversationId) {
                setConversationId(meta.conversationId);
                continue;
              }
            } catch {
              fullContent += chunk;
            }
          }
          firstChunk = false;
        } else {
          fullContent += chunk;
        }

        setStreamingContent(fullContent);
      }

      setMessages(prev => [...prev, { role: 'assistant', content: fullContent }]);
      setStreamingContent('');
      mutateConversations();
    } catch (error) {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Sorry, an error occurred. Please check your API key in settings.' }]);
    } finally {
      setLoading(false);
    }
  }, [conversationId, loading, mutateConversations]);

  const handleNewChat = () => {
    setConversationId(null);
    setMessages([]);
    setStreamingContent('');
  };

  return (
    <Box sx={{ display: 'flex', height: 'calc(100vh - 48px)' }}>
      {/* Conversation sidebar */}
      <Drawer
        variant="temporary"
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        sx={{ '& .MuiDrawer-paper': { width: 280, position: 'relative' } }}
      >
        <Box sx={{ p: 2 }}>
          <Button fullWidth variant="outlined" startIcon={<AddIcon />} onClick={handleNewChat}>
            New Chat
          </Button>
        </Box>
        <Divider />
        <List>
          {(conversations ?? []).map((conv: { id: number; title: string | null; updatedAt: string }) => (
            <ListItemButton
              key={conv.id}
              selected={conv.id === conversationId}
              onClick={() => loadConversation(conv.id)}
            >
              <ListItemText
                primary={conv.title || 'Untitled'}
                primaryTypographyProps={{ noWrap: true, fontSize: '0.875rem' }}
              />
            </ListItemButton>
          ))}
        </List>
      </Drawer>

      {/* Main chat area */}
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
          <Button size="small" onClick={() => setSidebarOpen(true)}>History</Button>
          <Typography variant="h4">AI Chat</Typography>
        </Box>

        {/* Messages */}
        <Box sx={{ flex: 1, overflow: 'auto', mb: 2 }}>
          {messages.length === 0 && !streamingContent ? (
            <Box sx={{ textAlign: 'center', py: 6 }}>
              <Typography variant="h6" color="text.secondary" gutterBottom>
                Ask me about your finances
              </Typography>
              <Stack direction="row" spacing={1} justifyContent="center" flexWrap="wrap" useFlexGap>
                {QUICK_PROMPTS.map((qp) => (
                  <Button
                    key={qp.label}
                    variant="outlined"
                    size="small"
                    onClick={() => sendMessage(qp.prompt)}
                    sx={{ mb: 1 }}
                  >
                    {qp.label}
                  </Button>
                ))}
              </Stack>
            </Box>
          ) : (
            <Stack spacing={2}>
              {messages.map((msg, i) => (
                <Paper
                  key={i}
                  sx={{
                    p: 2,
                    maxWidth: '80%',
                    alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                    bgcolor: msg.role === 'user' ? 'primary.dark' : 'background.paper',
                    ml: msg.role === 'user' ? 'auto' : 0,
                  }}
                >
                  {msg.role === 'assistant' ? (
                    <Box sx={{ '& p': { m: 0 }, '& ul': { pl: 2 }, '& h1,& h2,& h3': { mt: 1, mb: 0.5 } }}>
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    </Box>
                  ) : (
                    <Typography>{msg.content}</Typography>
                  )}
                </Paper>
              ))}
              {streamingContent && (
                <Paper sx={{ p: 2, maxWidth: '80%', bgcolor: 'background.paper' }}>
                  <Box sx={{ '& p': { m: 0 }, '& ul': { pl: 2 } }}>
                    <ReactMarkdown>{streamingContent}</ReactMarkdown>
                  </Box>
                </Paper>
              )}
              {loading && !streamingContent && (
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                  <CircularProgress size={16} />
                  <Typography variant="body2" color="text.secondary">Thinking...</Typography>
                </Box>
              )}
              <div ref={messagesEndRef} />
            </Stack>
          )}
        </Box>

        {/* Disclaimer */}
        <Typography variant="caption" color="text.secondary" sx={{ mb: 1, textAlign: 'center' }}>
          AI responses are for informational purposes only. Not financial advice.
        </Typography>

        {/* Input */}
        <Box sx={{ display: 'flex', gap: 1 }}>
          <TextField
            fullWidth
            size="small"
            placeholder="Ask about your finances..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input); } }}
            disabled={loading}
          />
          <IconButton color="primary" onClick={() => sendMessage(input)} disabled={loading || !input.trim()}>
            <SendIcon />
          </IconButton>
        </Box>
      </Box>
    </Box>
  );
}
