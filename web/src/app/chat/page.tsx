'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Box, Typography, TextField, IconButton, Button, Stack,
  List, ListItemButton, ListItemText, Paper, Divider, Drawer,
  CircularProgress, Chip,
} from '@mui/material';
import SendIcon from '@mui/icons-material/Send';
import AddIcon from '@mui/icons-material/Add';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import BarChartIcon from '@mui/icons-material/BarChart';
import AccountBalanceIcon from '@mui/icons-material/AccountBalance';
import HomeWorkIcon from '@mui/icons-material/HomeWork';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import BuildIcon from '@mui/icons-material/Build';
import useSWR from 'swr';
import ReactMarkdown from 'react-markdown';

const fetcher = (url: string) => fetch(url).then(r => r.json());

const QUICK_PROMPTS = [
  { label: 'Spending Summary', prompt: 'Give me a spending summary for the last few months', icon: <BarChartIcon sx={{ fontSize: 18 }} /> },
  { label: 'Budget Check', prompt: 'Analyze my budget and suggest improvements', icon: <AccountBalanceIcon sx={{ fontSize: 18 }} /> },
  { label: 'Property Report', prompt: 'Generate a property equity report', icon: <HomeWorkIcon sx={{ fontSize: 18 }} /> },
  { label: 'Net Worth', prompt: 'Analyze my net worth and financial health', icon: <TrendingUpIcon sx={{ fontSize: 18 }} /> },
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
  const [activeTools, setActiveTools] = useState<string[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const { data: conversations, mutate: mutateConversations } = useSWR('/api/chat/conversations', fetcher);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(scrollToBottom, [messages, streamingContent, activeTools]);

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
    setActiveTools([]);

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
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Process complete lines from the buffer
        const lines = buffer.split('\n');
        // Keep the last incomplete line in the buffer
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line) continue;

          // Try to parse as JSON (metadata or tool status)
          try {
            const parsed = JSON.parse(line);
            if (parsed.conversationId) {
              setConversationId(parsed.conversationId);
              continue;
            }
            if (parsed.tool) {
              setActiveTools(prev => [...prev, parsed.label]);
              continue;
            }
          } catch {
            // Not JSON — it's text content
          }

          // Treat as response text
          fullContent += line;
          setStreamingContent(fullContent);
        }

        // Remaining buffer content that isn't a complete line is likely
        // streaming text (not newline-terminated)
        if (buffer) {
          setStreamingContent(fullContent + buffer);
        }
      }

      // Process any remaining buffer
      if (buffer) {
        fullContent += buffer;
        setStreamingContent(fullContent);
      }

      setMessages(prev => [...prev, { role: 'assistant', content: fullContent }]);
      setStreamingContent('');
      setActiveTools([]);
      mutateConversations();
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Sorry, an error occurred. Please check your API key in settings.' }]);
    } finally {
      setLoading(false);
    }
  }, [conversationId, loading, mutateConversations]);

  const handleNewChat = () => {
    setConversationId(null);
    setMessages([]);
    setStreamingContent('');
    setActiveTools([]);
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
            <Box sx={{ textAlign: 'center', py: 8 }}>
              <AutoAwesomeIcon sx={{ fontSize: 48, color: 'primary.main', opacity: 0.7, mb: 2 }} />
              <Typography variant="h6" color="text.secondary" gutterBottom>
                Ask me about your finances
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 3, maxWidth: 400, mx: 'auto' }}>
                I can analyze your spending, review your budget, categorize transactions, manage rules, and add tips to your dashboard.
              </Typography>
              <Stack direction="row" spacing={1} justifyContent="center" flexWrap="wrap" useFlexGap>
                {QUICK_PROMPTS.map((qp) => (
                  <Button
                    key={qp.label}
                    variant="outlined"
                    size="small"
                    startIcon={qp.icon}
                    onClick={() => sendMessage(qp.prompt)}
                    sx={{
                      mb: 1,
                      '&:hover': {
                        bgcolor: 'rgba(78, 205, 196, 0.08)',
                        borderColor: 'primary.main',
                      },
                    }}
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
                    borderLeft: msg.role === 'assistant' ? '3px solid' : 'none',
                    borderColor: msg.role === 'assistant' ? 'primary.main' : 'transparent',
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

              {/* Tool status indicators */}
              {activeTools.length > 0 && (
                <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', alignItems: 'center' }}>
                  <BuildIcon sx={{ fontSize: 16, color: 'primary.main', mr: 0.5 }} />
                  {activeTools.map((label, i) => (
                    <Chip
                      key={i}
                      label={label}
                      size="small"
                      variant="outlined"
                      color="primary"
                      sx={{ fontSize: '0.75rem' }}
                    />
                  ))}
                </Box>
              )}

              {streamingContent && (
                <Paper sx={{ p: 2, maxWidth: '80%', bgcolor: 'background.paper', borderLeft: '3px solid', borderColor: 'primary.main' }}>
                  <Box sx={{ '& p': { m: 0 }, '& ul': { pl: 2 } }}>
                    <ReactMarkdown>{streamingContent}</ReactMarkdown>
                  </Box>
                </Paper>
              )}
              {loading && !streamingContent && activeTools.length === 0 && (
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
        <Paper variant="outlined" sx={{ display: 'flex', gap: 1, p: 1 }}>
          <TextField
            fullWidth
            size="small"
            placeholder="Ask about your finances..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input); } }}
            disabled={loading}
            sx={{ '& .MuiOutlinedInput-notchedOutline': { border: 'none' } }}
          />
          <IconButton color="primary" onClick={() => sendMessage(input)} disabled={loading || !input.trim()}>
            <SendIcon />
          </IconButton>
        </Paper>
      </Box>
    </Box>
  );
}
