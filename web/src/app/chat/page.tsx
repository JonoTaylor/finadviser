'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Box, Typography, TextField, IconButton, Button, Stack,
  List, ListItemButton, ListItemText, Paper, Divider, Drawer,
  CircularProgress, Chip,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import SendRoundedIcon from '@mui/icons-material/SendRounded';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded';
import BarChartRoundedIcon from '@mui/icons-material/BarChartRounded';
import AccountBalanceRoundedIcon from '@mui/icons-material/AccountBalanceRounded';
import HomeWorkRoundedIcon from '@mui/icons-material/HomeWorkRounded';
import TrendingUpRoundedIcon from '@mui/icons-material/TrendingUpRounded';
import MemoryRoundedIcon from '@mui/icons-material/MemoryRounded';
import HistoryRoundedIcon from '@mui/icons-material/HistoryRounded';
import useSWR from 'swr';
import ReactMarkdown from 'react-markdown';

const fetcher = (url: string) => fetch(url).then(r => r.json());

const QUICK_PROMPTS = [
  { label: 'Spending Summary', prompt: 'Give me a spending summary for the last few months', icon: <BarChartRoundedIcon sx={{ fontSize: 18 }} /> },
  { label: 'Budget Check', prompt: 'Analyze my budget and suggest improvements', icon: <AccountBalanceRoundedIcon sx={{ fontSize: 18 }} /> },
  { label: 'Property Report', prompt: 'Generate a property equity report', icon: <HomeWorkRoundedIcon sx={{ fontSize: 18 }} /> },
  { label: 'Net Worth', prompt: 'Analyze my net worth and financial health', icon: <TrendingUpRoundedIcon sx={{ fontSize: 18 }} /> },
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
        body: JSON.stringify({ message: text, conversationId }),
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
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line) continue;
          try {
            const parsed = JSON.parse(line);
            if (parsed.conversationId) { setConversationId(parsed.conversationId); continue; }
            if (parsed.tool) { setActiveTools(prev => [...prev, parsed.label]); continue; }
          } catch { /* text content */ }
          fullContent += line;
          setStreamingContent(fullContent);
        }

        if (buffer) setStreamingContent(fullContent + buffer);
      }

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
        sx={{ '& .MuiDrawer-paper': { width: 300 } }}
      >
        <Box sx={{ p: 2 }}>
          <Button fullWidth variant="outlined" startIcon={<AddRoundedIcon />} onClick={handleNewChat}>
            New Chat
          </Button>
        </Box>
        <Divider />
        <List sx={{ px: 1 }}>
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
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
          <Button
            size="small"
            variant="outlined"
            startIcon={<HistoryRoundedIcon />}
            onClick={() => setSidebarOpen(true)}
          >
            History
          </Button>
          <Typography variant="h4">AI Chat</Typography>
        </Box>

        {/* Messages */}
        <Box sx={{ flex: 1, overflow: 'auto', mb: 2 }}>
          {messages.length === 0 && !streamingContent ? (
            <Box sx={{ textAlign: 'center', py: 10 }}>
              <Box
                sx={{
                  width: 64, height: 64, borderRadius: 4, mx: 'auto', mb: 2,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: 'linear-gradient(135deg, rgba(94,234,212,0.15), rgba(167,139,250,0.15))',
                }}
              >
                <AutoAwesomeRoundedIcon sx={{ fontSize: 32, color: 'primary.main' }} />
              </Box>
              <Typography variant="h5" sx={{ mb: 1 }}>
                Ask me anything
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 4, maxWidth: 420, mx: 'auto' }}>
                I can look up your data, analyze spending, categorize transactions, manage rules, and add tips to your dashboard.
              </Typography>
              <Stack direction="row" spacing={1} justifyContent="center" flexWrap="wrap" useFlexGap>
                {QUICK_PROMPTS.map((qp) => (
                  <Button
                    key={qp.label}
                    variant="outlined"
                    size="small"
                    startIcon={qp.icon}
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
                  elevation={0}
                  sx={{
                    p: 2,
                    maxWidth: '80%',
                    alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                    bgcolor: msg.role === 'user'
                      ? alpha('#5EEAD4', 0.1)
                      : alpha('#A78BFA', 0.06),
                    ml: msg.role === 'user' ? 'auto' : 0,
                    borderLeft: msg.role === 'assistant' ? '3px solid' : 'none',
                    borderColor: msg.role === 'assistant' ? 'secondary.main' : 'transparent',
                    borderRadius: 4,
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
                <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', alignItems: 'center', pl: 0.5 }}>
                  <MemoryRoundedIcon sx={{ fontSize: 16, color: 'secondary.main' }} />
                  {activeTools.map((label, i) => (
                    <Chip
                      key={i}
                      label={label}
                      size="small"
                      variant="outlined"
                      color="secondary"
                      sx={{ fontSize: '0.75rem', height: 26 }}
                    />
                  ))}
                </Box>
              )}

              {streamingContent && (
                <Paper
                  elevation={0}
                  sx={{
                    p: 2, maxWidth: '80%',
                    bgcolor: alpha('#A78BFA', 0.06),
                    borderLeft: '3px solid',
                    borderColor: 'secondary.main',
                    borderRadius: 4,
                  }}
                >
                  <Box sx={{ '& p': { m: 0 }, '& ul': { pl: 2 } }}>
                    <ReactMarkdown>{streamingContent}</ReactMarkdown>
                  </Box>
                </Paper>
              )}
              {loading && !streamingContent && activeTools.length === 0 && (
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', pl: 0.5 }}>
                  <CircularProgress size={16} color="secondary" />
                  <Typography variant="body2" color="text.secondary">Thinking...</Typography>
                </Box>
              )}
              <div ref={messagesEndRef} />
            </Stack>
          )}
        </Box>

        {/* Disclaimer */}
        <Typography variant="caption" color="text.secondary" sx={{ mb: 1, textAlign: 'center', opacity: 0.6 }}>
          AI responses are for informational purposes only. Not financial advice.
        </Typography>

        {/* Input */}
        <Paper
          elevation={0}
          sx={{
            display: 'flex', gap: 1, p: 1,
            bgcolor: 'background.paper',
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 4,
          }}
        >
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
          <IconButton
            color="primary"
            onClick={() => sendMessage(input)}
            disabled={loading || !input.trim()}
            sx={{
              bgcolor: loading || !input.trim() ? 'transparent' : alpha('#5EEAD4', 0.12),
              '&:hover': { bgcolor: alpha('#5EEAD4', 0.2) },
            }}
          >
            <SendRoundedIcon />
          </IconButton>
        </Paper>
      </Box>
    </Box>
  );
}
