'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Box, Typography, TextField, IconButton, Button, Stack,
  List, ListItemButton, ListItemText, Paper, Divider, Drawer,
  CircularProgress, Chip, Alert, Skeleton,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import SendRoundedIcon from '@mui/icons-material/SendRounded';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded';
import TrendingUpRoundedIcon from '@mui/icons-material/TrendingUpRounded';
import CategoryRoundedIcon from '@mui/icons-material/CategoryRounded';
import AccountBalanceWalletRoundedIcon from '@mui/icons-material/AccountBalanceWalletRounded';
import SavingsRoundedIcon from '@mui/icons-material/SavingsRounded';
import ShoppingCartRoundedIcon from '@mui/icons-material/ShoppingCartRounded';
import CreditCardRoundedIcon from '@mui/icons-material/CreditCardRounded';
import HealthAndSafetyRoundedIcon from '@mui/icons-material/HealthAndSafetyRounded';
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded';
import MemoryRoundedIcon from '@mui/icons-material/MemoryRounded';
import HistoryRoundedIcon from '@mui/icons-material/HistoryRounded';
import useSWR from 'swr';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import PageHeader from '@/components/ui/PageHeader';
import { fetchJson } from '@/lib/http/client';

interface Conversation { id: number; title: string | null; updatedAt: string }
const fetcher = async (url: string): Promise<Conversation[]> => {
  const data = await fetchJson<unknown>(url);
  if (!Array.isArray(data)) throw new Error('Chat history returned an unreadable response.');
  return data as Conversation[];
};

// Stable plugin reference so ReactMarkdown doesn't re-process content
// on every render (a fresh array literal would invalidate its memo).
const REMARK_PLUGINS = [remarkGfm];

// Custom renderers — keep tables horizontally scrollable so a wide
// breakdown doesn't blow out the chat bubble on narrow viewports.
// `node` (a hast Element from react-markdown) is destructured out so
// it isn't spread onto the native <table> as an unknown DOM attr.
// Bottom margin lives on `& table` in markdownSx; don't double it here.
const markdownComponents = {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  table: ({ node: _node, ...props }: { node?: unknown } & React.HTMLAttributes<HTMLTableElement>) => (
    <Box sx={{ overflowX: 'auto', minWidth: 0, maxWidth: '100%' }}>
      <table {...props} />
    </Box>
  ),
};

const markdownSx = {
  fontSize: '0.875rem', minWidth: 0, overflowWrap: 'anywhere',
  '& img': { maxWidth: '100%' },
  '& p': { m: 0, mb: 1.5, lineHeight: 1.7, '&:last-child': { mb: 0 } },
  '& h1': { fontSize: '1.4rem', fontWeight: 700, mt: 2.5, mb: 1, '&:first-of-type': { mt: 0 } },
  '& h2': { fontSize: '1.2rem', fontWeight: 700, mt: 2.5, mb: 1, '&:first-of-type': { mt: 0 } },
  '& h3': { fontSize: '1.05rem', fontWeight: 600, mt: 2, mb: 0.75, '&:first-of-type': { mt: 0 } },
  '& h4, & h5, & h6': { fontSize: '0.95rem', fontWeight: 600, mt: 1.5, mb: 0.5 },
  '& ul, & ol': { pl: 2.5, mb: 1.5, '& li': { mb: 0.5, lineHeight: 1.6 } },
  '& hr': { border: 'none', borderTop: '1px solid', borderColor: 'divider', my: 2 },
  '& table': {
    width: '100%', borderCollapse: 'collapse', mb: 1.5, fontSize: '0.875rem',
    '& th': { textAlign: 'left', fontWeight: 600, p: '8px 12px', borderBottom: '2px solid', borderColor: 'divider' },
    '& td': { p: '6px 12px', borderBottom: '1px solid', borderColor: 'divider' },
    '& tr:last-child td': { borderBottom: 'none' },
  },
  '& code': {
    fontFamily: 'monospace', fontSize: '0.85em',
    bgcolor: 'action.hover', px: 0.75, py: 0.25, borderRadius: '3px',
  },
  '& pre': {
    bgcolor: 'action.hover', borderRadius: '6px', p: 2, mb: 1.5, overflow: 'auto', maxWidth: '100%',
    '& code': { bgcolor: 'transparent', p: 0, fontSize: '0.85rem' },
  },
  '& blockquote': {
    borderLeft: '3px solid', borderColor: 'primary.main', pl: 2, ml: 0, my: 1.5,
    color: 'text.secondary',
  },
  '& strong': { fontWeight: 600 },
  '& a': { color: 'primary.main', textDecoration: 'none', '&:hover': { textDecoration: 'underline' } },
} as const;

const QUICK_PROMPTS = [
  { label: 'Spending Analysis', prompt: 'Break down my spending for the last month', icon: <TrendingUpRoundedIcon sx={{ fontSize: 18 }} /> },
  { label: 'Categorize', prompt: 'Review my uncategorized transactions and categorize them', icon: <CategoryRoundedIcon sx={{ fontSize: 18 }} /> },
  { label: 'Categorisation Pass', prompt: 'Run a backward month-by-month categorisation pass: start with the most recent month that has uncategorised transactions, propose categorisations grouped by payee, and turn each confirmed mapping into a rule so earlier months auto-categorise themselves. Stop and ask me to confirm each batch before applying.', icon: <CategoryRoundedIcon sx={{ fontSize: 18 }} /> },
  { label: 'Budget Review', prompt: 'How am I tracking against my budgets this month?', icon: <AccountBalanceWalletRoundedIcon sx={{ fontSize: 18 }} /> },
  { label: 'Savings Goals', prompt: 'What\'s my progress on savings goals?', icon: <SavingsRoundedIcon sx={{ fontSize: 18 }} /> },
  { label: 'Can I Afford...', prompt: 'Can I afford a big purchase? Help me figure out if it\'s feasible', icon: <ShoppingCartRoundedIcon sx={{ fontSize: 18 }} /> },
  { label: 'Debt Strategy', prompt: 'Analyze my debts and suggest an optimal repayment strategy', icon: <CreditCardRoundedIcon sx={{ fontSize: 18 }} /> },
  { label: 'Health Check', prompt: 'Run a full financial health check on my finances', icon: <HealthAndSafetyRoundedIcon sx={{ fontSize: 18 }} /> },
  { label: 'What to Watch', prompt: 'What should I watch out for in my finances?', icon: <WarningAmberRoundedIcon sx={{ fontSize: 18 }} /> },
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
  const messagesViewportRef = useRef<HTMLDivElement>(null);
  const [loadingConversation, setLoadingConversation] = useState<number | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const { data: conversations, error: conversationsError, isLoading: historyLoading, mutate: mutateConversations } = useSWR<Conversation[]>('/api/chat/conversations', fetcher, { shouldRetryOnError: false });

  const scrollToBottom = () => {
    const viewport = messagesViewportRef.current;
    viewport?.scrollTo({ top: viewport.scrollHeight, behavior: 'smooth' });
  };

  useEffect(scrollToBottom, [messages, streamingContent, activeTools]);

  const loadConversation = useCallback(async (id: number) => {
    if (loading || loadingConversation !== null) return;
    setHistoryError(null);
    setLoadingConversation(id);
    try {
      const data = await fetchJson<unknown>(`/api/chat/conversations/${id}`);
      if (!Array.isArray(data) || data.some(item => !item || typeof item.role !== 'string' || typeof item.content !== 'string')) {
        throw new Error('Conversation returned an unreadable response.');
      }
      const nextMessages = data.filter(item => item.role === 'user' || item.role === 'assistant').map(item => ({ role: item.role, content: item.content })) as Message[];
      setConversationId(id);
      setMessages(nextMessages);
      setSendError(null);
      setSidebarOpen(false);
    } catch {
      setHistoryError('This conversation could not be loaded. Your current chat is unchanged. Please try again.');
    } finally {
      setLoadingConversation(null);
    }
  }, [loading, loadingConversation]);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || loading || loadingConversation !== null) return;

    const userMsg: Message = { role: 'user', content: text };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);
    setSendError(null);
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
          if (line) {
            try {
              const parsed = JSON.parse(line);
              if (parsed.conversationId) { setConversationId(parsed.conversationId); continue; }
              if (parsed.tool) { setActiveTools(prev => [...prev, parsed.label]); continue; }
            } catch { /* text content */ }
          }
          fullContent += line + '\n';
          setStreamingContent(fullContent);
        }

        if (buffer) setStreamingContent(fullContent + buffer);
      }

      if (buffer) {
        fullContent += buffer;
        setStreamingContent(fullContent);
      }

      setMessages(prev => [...prev, { role: 'assistant', content: fullContent.trim() }]);
      setStreamingContent('');
      setActiveTools([]);
      mutateConversations();
    } catch {
      setSendError('The adviser response is unavailable or was interrupted. Check your connection and try again.');
    } finally {
      setLoading(false);
      setActiveTools([]);
    }
  }, [conversationId, loading, loadingConversation, mutateConversations]);

  const handleNewChat = () => {
    if (loading || loadingConversation !== null) return;
    setConversationId(null);
    setMessages([]);
    setStreamingContent('');
    setActiveTools([]);
    setHistoryError(null);
    setSendError(null);
    setSidebarOpen(false);
  };

  return <Box sx={{
    display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0,
    height: { xs: 'calc(100dvh - 96px)', sm: 'calc(100dvh - 112px)', md: 'calc(100dvh - 128px)', xl: 'calc(100dvh - 144px)' },
  }}>
    <Box sx={{ flexShrink: 0 }}><PageHeader title="Financial adviser" description="Make your next financial decision with a clearer picture." actions={<>
      <Button size="small" variant="outlined" startIcon={<HistoryRoundedIcon />} onClick={() => setSidebarOpen(true)}>History</Button>
      <Button size="small" variant="outlined" startIcon={<AddRoundedIcon />} onClick={handleNewChat} disabled={loading || loadingConversation !== null}>New chat</Button>
    </>} /></Box>

    <Drawer variant="temporary" open={sidebarOpen} onClose={() => setSidebarOpen(false)}
      sx={{ '& .MuiDrawer-paper': { width: 320, maxWidth: 'calc(100vw - 32px)', bgcolor: 'background.paper', color: 'text.primary', borderRadius: 0 } }}>
      <Box sx={{ p: 2.5 }}><Typography variant="h6" sx={{ mb: 0.75 }}>Conversation history</Typography><Typography variant="body2" color="text.secondary">Continue a previous financial discussion.</Typography></Box>
      <Divider />
      <Box sx={{ p: 2 }}>
        <Button fullWidth variant="outlined" startIcon={<AddRoundedIcon />} onClick={handleNewChat} disabled={loading || loadingConversation !== null}>New chat</Button>
        {historyLoading && !conversations && <Skeleton height={70} sx={{ mt: 1 }} />}
        {conversationsError && <Alert severity="warning" sx={{ mt: 2 }}>Conversation history is unavailable. Your current chat remains open.<Button size="small" onClick={() => mutateConversations()} sx={{ display: 'block', mt: 1 }}>Try again</Button></Alert>}
        {historyError && <Alert severity="error" sx={{ mt: 2 }}>{historyError}</Alert>}
      </Box>
      <List sx={{ px: 1, minWidth: 0 }}>
        {(conversations ?? []).map(conversation => <ListItemButton key={conversation.id} selected={conversation.id === conversationId}
          onClick={() => loadConversation(conversation.id)} disabled={loading || loadingConversation !== null} sx={{ borderRadius: '6px', color: 'text.primary', '&.Mui-selected': { bgcolor: 'action.selected', color: 'text.primary' } }}>
          <ListItemText primary={conversation.title || 'Untitled conversation'} primaryTypographyProps={{ noWrap: true, fontSize: '0.8125rem', fontWeight: 500 }} />
          {loadingConversation === conversation.id && <CircularProgress size={14} />}
        </ListItemButton>)}
        {!historyLoading && !conversationsError && conversations?.length === 0 && <Typography variant="body2" color="text.secondary" sx={{ px: 2, py: 1 }}>No saved conversations yet.</Typography>}
      </List>
    </Drawer>

    <Paper elevation={0} sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0, border: 1, borderColor: 'divider', borderRadius: '8px', overflow: 'hidden' }}>
      <Box ref={messagesViewportRef} sx={{ flex: 1, minHeight: 0, minWidth: 0, overflowY: 'auto', overscrollBehavior: 'contain', px: { xs: 2, md: 3 }, py: 2.5 }}>
        {messages.length === 0 && !streamingContent ? <Box sx={{ maxWidth: 840, mx: 'auto', py: { xs: 1, sm: 3 } }}>
          <Stack direction="row" alignItems="center" gap={1.25} sx={{ mb: 1.25 }}><AutoAwesomeRoundedIcon sx={{ fontSize: 22, color: 'primary.main' }} /><Typography variant="h6">Where would you like to start?</Typography></Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5, maxWidth: 640 }}>Review spending, build a plan or explore a financial decision using your recorded accounts and planning workspaces.</Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(3, minmax(0, 1fr))' }, gap: 1 }}>
            {QUICK_PROMPTS.map(prompt => <Button key={prompt.label} variant="outlined" size="small" startIcon={prompt.icon} onClick={() => sendMessage(prompt.prompt)}
              sx={{ justifyContent: 'flex-start', py: 1.5, px: 1.5, minWidth: 0, textAlign: 'left' }}>{prompt.label}</Button>)}
          </Box>
        </Box> : <Stack spacing={2}>
          {messages.map((message, index) => <Paper key={index} elevation={0} sx={{
            p: { xs: 1.5, sm: 2 }, minWidth: 0, maxWidth: { xs: '100%', sm: '90%' }, overflowWrap: 'anywhere',
            alignSelf: message.role === 'user' ? 'flex-end' : 'flex-start', bgcolor: message.role === 'user' ? '#EDF7F5' : 'background.paper',
            border: 1, borderColor: message.role === 'user' ? '#D2E9E4' : 'divider', borderRadius: '8px',
          }}>
            <Typography variant="caption" sx={{ display: 'block', fontWeight: 600, mb: 0.75 }}>{message.role === 'user' ? 'You' : 'Adviser'}</Typography>
            {message.role === 'assistant' ? <Box sx={markdownSx}><ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={markdownComponents}>{message.content}</ReactMarkdown></Box> : <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>{message.content}</Typography>}
          </Paper>)}
          {activeTools.length > 0 && <Stack direction="row" gap={0.75} flexWrap="wrap" alignItems="center" aria-live="polite">
            <MemoryRoundedIcon sx={{ fontSize: 16, color: 'primary.main' }} />{activeTools.map((label, index) => <Chip key={index} label={label} size="small" variant="outlined" />)}
          </Stack>}
          {streamingContent && <Paper elevation={0} sx={{ p: { xs: 1.5, sm: 2 }, maxWidth: { xs: '100%', sm: '90%' }, minWidth: 0, alignSelf: 'flex-start', border: 1, borderColor: 'divider', borderRadius: '8px' }}>
            <Typography variant="caption" sx={{ display: 'block', fontWeight: 600, mb: 0.75 }}>{sendError ? 'Incomplete adviser response' : 'Adviser'}</Typography>
            <Box sx={markdownSx}><ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={markdownComponents}>{streamingContent}</ReactMarkdown></Box>
          </Paper>}
          {loading && !streamingContent && activeTools.length === 0 && <Stack direction="row" gap={1} alignItems="center" aria-live="polite"><CircularProgress size={16} /><Typography variant="body2" color="text.secondary">Reviewing your question…</Typography></Stack>}
        </Stack>}
      </Box>

      <Box sx={{ flexShrink: 0, borderTop: 1, borderColor: 'divider', p: { xs: 1.5, sm: 2 }, bgcolor: 'background.paper' }}>
        {sendError && <Alert severity="error" sx={{ mb: 1.5 }}>{sendError}</Alert>}
        <Stack direction="row" gap={1} alignItems="flex-end" sx={{ border: 1, borderColor: 'divider', borderRadius: '6px', p: 0.5, minWidth: 0 }}>
          <TextField fullWidth multiline minRows={1} maxRows={4} size="small" placeholder="Ask about your finances…" value={input} onChange={event => setInput(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); sendMessage(input); } }}
            disabled={loading || loadingConversation !== null} inputProps={{ 'aria-label': 'Message your financial adviser' }}
            sx={{ minWidth: 0, '& .MuiOutlinedInput-notchedOutline': { border: 'none' } }} />
          <IconButton aria-label="Send message" color="primary" onClick={() => sendMessage(input)} disabled={loading || loadingConversation !== null || !input.trim()}
            sx={{ flexShrink: 0, borderRadius: '5px', bgcolor: !loading && input.trim() ? theme => alpha(theme.palette.primary.main, 0.08) : 'transparent' }}><SendRoundedIcon sx={{ fontSize: 20 }} /></IconButton>
        </Stack>
        <Typography variant="caption" sx={{ display: 'block', mt: 1, textAlign: 'center', fontSize: '0.6875rem' }}>AI responses are informational. Check the evidence and assumptions before acting.</Typography>
      </Box>
    </Paper>
  </Box>;
}
