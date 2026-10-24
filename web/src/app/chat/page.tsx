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
import StopRoundedIcon from '@mui/icons-material/StopRounded';
import useSWR from 'swr';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import PageHeader from '@/components/ui/PageHeader';
import { fetchJson } from '@/lib/http/client';
import AdviserCapabilitiesStatus from '@/components/chat/AdviserCapabilities';
import SpecialistTeamSelector, { adviserModeName } from '@/components/chat/SpecialistTeamSelector';
import SpecialistReviews from '@/components/chat/SpecialistReviews';
import { createChatStreamDecoder } from '@/components/chat/chat-stream';
import ChatFailureNotice from '@/components/chat/ChatFailureNotice';
import ChatCategorizationProgress from '@/components/data/ChatCategorizationProgress';
import { ChatRequestFailure, chatHttpFailure, type ChatFailure } from '@/components/chat/chat-failure';
import { SPECIALISTS, type AdviserMode, type SpecialistId } from '@/lib/ai/specialists/catalog';
import { adviserMessageMetadataSchema, type AdviserMessageMetadata, type SpecialistResult } from '@/lib/ai/specialists/contracts';

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
    width: '100%', minWidth: 480, borderCollapse: 'collapse', mb: 1.5, fontSize: '0.875rem', overflowWrap: 'normal',
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
  metadata?: AdviserMessageMetadata;
}

function readConversation(value: unknown): Message[] {
  if (!Array.isArray(value) || value.some(item => !item || typeof item.role !== 'string' || typeof item.content !== 'string')) {
    throw new Error('Conversation returned an unreadable response.');
  }
  return value.filter(item => item.role === 'user' || item.role === 'assistant').map(item => {
    const metadata = adviserMessageMetadataSchema.safeParse(item.metadata);
    return { role: item.role as Message['role'], content: item.content, ...(metadata.success ? { metadata: metadata.data } : {}) };
  });
}

export default function ChatPage() {
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedMode, setSelectedMode] = useState<AdviserMode>('team');
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [activeTools, setActiveTools] = useState<string[]>([]);
  const [liveResults, setLiveResults] = useState<SpecialistResult[]>([]);
  const [pendingSpecialists, setPendingSpecialists] = useState<SpecialistId[]>([]);
  const messagesViewportRef = useRef<HTMLDivElement>(null);
  const requestController = useRef<AbortController | null>(null);
  const loadPending = useRef(false);
  const [loadingConversation, setLoadingConversation] = useState<number | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<ChatFailure | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const busy = loading || loadingConversation !== null;

  const { data: conversations, error: conversationsError, isLoading: historyLoading, mutate: mutateConversations } = useSWR<Conversation[]>('/api/chat/conversations', fetcher, { shouldRetryOnError: false });

  useEffect(() => {
    const viewport = messagesViewportRef.current;
    const emptyConversation = messages.length === 0 && !loading && !streamingContent && liveResults.length === 0 && pendingSpecialists.length === 0;
    viewport?.scrollTo({ top: emptyConversation ? 0 : viewport.scrollHeight, behavior: emptyConversation ? 'auto' : 'smooth' });
  }, [messages, streamingContent, activeTools, liveResults, pendingSpecialists, loading, selectedMode]);

  const loadConversation = useCallback(async (id: number) => {
    if (requestController.current || loadPending.current) return;
    loadPending.current = true;
    setHistoryError(null);
    setLoadingConversation(id);
    try {
      const nextMessages = readConversation(await fetchJson<unknown>('/api/chat/conversations/' + id));
      const latestMetadata = [...nextMessages].reverse().find(message => message.metadata)?.metadata;
      setSelectedMode(latestMetadata?.specialistMode ?? 'team');
      setConversationId(id);
      setMessages(nextMessages);
      setStreamingContent('');
      setLiveResults([]);
      setPendingSpecialists([]);
      setSendError(null);
      setSidebarOpen(false);
    } catch {
      setHistoryError('This conversation could not be loaded. Your current chat is unchanged. Please try again.');
    } finally {
      loadPending.current = false;
      setLoadingConversation(null);
    }
  }, []);

  const sendMessage = useCallback(async (text: string, modeOverride?: AdviserMode) => {
    if (!text.trim() || requestController.current || loadPending.current) return;
    const mode = modeOverride ?? selectedMode;
    const controller = new AbortController();
    requestController.current = controller;
    setSelectedMode(mode);
    setMessages(previous => [...previous, { role: 'user', content: text }]);
    setInput('');
    setLoading(true);
    setSendError(null);
    setStreamingContent('');
    setActiveTools([]);
    setLiveResults([]);
    setPendingSpecialists([]);

    let fullContent = '';
    let results: SpecialistResult[] = [];
    let completedMetadata: AdviserMessageMetadata | undefined;
    let streamError: ChatFailure | null = null;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const response = await fetch('/api/ai/analyze', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ message: text, conversationId, specialist: mode, streamVersion: 2 }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new ChatRequestFailure(chatHttpFailure(body));
      }
      reader = response.body?.getReader();
      if (!reader) throw new Error('The adviser returned no response stream.');
      const decoder = createChatStreamDecoder(event => {
        if (event.type === 'conversation') setConversationId(event.conversationId);
        else if (event.type === 'specialist-start') {
          setPendingSpecialists(previous => previous.includes(event.specialistId) ? previous : [...previous, event.specialistId]);
        } else if (event.type === 'specialist-result') {
          results = [...results.filter(result => result.specialistId !== event.result.specialistId), event.result];
          setLiveResults([...results]);
          setPendingSpecialists(previous => previous.filter(id => id !== event.result.specialistId));
        } else if (event.type === 'tool') {
          setActiveTools(previous => previous.includes(event.label) ? previous : [...previous, event.label]);
        } else if (event.type === 'text') {
          fullContent += event.content;
          setStreamingContent(fullContent);
        } else if (event.type === 'complete') {
          if (event.metadata && event.metadata.specialistMode !== mode) throw new Error('The adviser returned a different review focus. Your message has been kept.');
          completedMetadata = event.metadata;
        } else if (event.type === 'error') streamError = event;
      });
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        decoder.push(part.value);
        if (streamError) throw new ChatRequestFailure(streamError);
      }
      decoder.finish();
      if (streamError) throw new ChatRequestFailure(streamError);
      if (!decoder.getState().complete) throw new Error('The adviser response ended before completion could be confirmed.');
      const metadata: AdviserMessageMetadata = completedMetadata ?? {
        version: 1, specialistMode: mode, specialistResults: results, status: 'complete',
      };
      setMessages(previous => [...previous, { role: 'assistant', content: fullContent.trim(), metadata }]);
      setStreamingContent('');
      setLiveResults([]);
      setPendingSpecialists([]);
      void mutateConversations();
    } catch (error) {
      if (reader) await reader.cancel().catch(() => undefined);
      const failure: ChatFailure = controller.signal.aborted
        ? { message: 'Response stopped. Any answer or specialist notes shown may be incomplete.' }
        : error instanceof ChatRequestFailure ? error.failure
          : { message: error instanceof Error ? error.message : 'The adviser response was interrupted.' };
      if (fullContent.trim() || results.length > 0) {
        const metadata: AdviserMessageMetadata = { version: 1, specialistMode: mode, specialistResults: results, status: failure.generationCompleted ? 'complete' : 'interrupted' };
        setMessages(previous => [...previous, { role: 'assistant', content: fullContent.trim(), metadata }]);
      }
      setStreamingContent('');
      setLiveResults([]);
      setPendingSpecialists([]);
      setInput(text);
      setSendError(failure);
      void mutateConversations();
    } finally {
      reader?.releaseLock();
      requestController.current = null;
      setLoading(false);
      setActiveTools([]);
    }
  }, [conversationId, selectedMode, mutateConversations]);

  const handleNewChat = () => {
    if (requestController.current || loadPending.current) return;
    setConversationId(null);
    setMessages([]);
    setStreamingContent('');
    setLiveResults([]);
    setPendingSpecialists([]);
    setActiveTools([]);
    setHistoryError(null);
    setSendError(null);
    setSidebarOpen(false);
  };
  const chosenSpecialist = SPECIALISTS.find(item => item.id === selectedMode);
  const startingQuestions = chosenSpecialist?.exampleQuestions ?? [];

  return <Box sx={{
    display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0,
    height: { xs: 'calc(100dvh - 96px)', sm: 'calc(100dvh - 112px)', md: 'calc(100dvh - 128px)', xl: 'calc(100dvh - 144px)' },
  }}>
    <Box sx={{ flexShrink: 0 }}>
      <PageHeader title="Financial adviser" description="One financial plan, supported by your specialist team." actions={<>
        <Button size="small" variant="outlined" startIcon={<HistoryRoundedIcon />} onClick={() => setSidebarOpen(true)}>History</Button>
        <Button size="small" variant="outlined" startIcon={<AddRoundedIcon />} onClick={handleNewChat} disabled={busy}>New chat</Button>
      </>} />
      <AdviserCapabilitiesStatus />
      <SpecialistTeamSelector value={selectedMode} disabled={busy} onChange={setSelectedMode}
        onAsk={(mode, question) => { void sendMessage(question, mode); }} />
    </Box>

    <Drawer variant="temporary" open={sidebarOpen} onClose={() => setSidebarOpen(false)}
      sx={{ '& .MuiDrawer-paper': { width: 320, maxWidth: 'calc(100vw - 32px)', bgcolor: 'background.paper', color: 'text.primary', borderRadius: 0 } }}>
      <Box sx={{ p: 2.5 }}><Typography variant="h6" sx={{ mb: 0.75 }}>Conversation history</Typography><Typography variant="body2" color="text.secondary">Continue a previous financial discussion.</Typography></Box>
      <Divider />
      <Box sx={{ p: 2 }}>
        <Button fullWidth variant="outlined" startIcon={<AddRoundedIcon />} onClick={handleNewChat} disabled={busy}>New chat</Button>
        {historyLoading && !conversations && <Skeleton height={70} sx={{ mt: 1 }} />}
        {conversationsError && <Alert severity="warning" sx={{ mt: 2 }}>Conversation history is unavailable. Your current chat remains open.<Button size="small" onClick={() => void mutateConversations()} sx={{ display: 'block', mt: 1 }}>Try again</Button></Alert>}
        {historyError && <Alert severity="error" sx={{ mt: 2 }}>{historyError}</Alert>}
      </Box>
      <List sx={{ px: 1, minWidth: 0 }}>
        {(conversations ?? []).map(conversation => <ListItemButton key={conversation.id} selected={conversation.id === conversationId}
          onClick={() => void loadConversation(conversation.id)} disabled={busy} sx={{ borderRadius: '6px', color: 'text.primary', '&.Mui-selected': { bgcolor: 'action.selected', color: 'text.primary' } }}>
          <ListItemText primary={conversation.title || 'Untitled conversation'} primaryTypographyProps={{ noWrap: true, fontSize: '0.8125rem', fontWeight: 500 }} />
          {loadingConversation === conversation.id && <CircularProgress size={14} />}
        </ListItemButton>)}
        {!historyLoading && !conversationsError && conversations?.length === 0 && <Typography variant="body2" color="text.secondary" sx={{ px: 2, py: 1 }}>No saved conversations yet.</Typography>}
      </List>
    </Drawer>

    <Paper elevation={0} sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0, border: 1, borderColor: 'divider', borderRadius: '8px', overflow: 'hidden' }}>
      <Box ref={messagesViewportRef} sx={{ flex: 1, minHeight: 0, minWidth: 0, overflowY: 'auto', overscrollBehavior: 'contain', px: { xs: 2, md: 3 }, py: 2.5 }}>
        {messages.length === 0 && !loading ? <Box sx={{ maxWidth: 840, mx: 'auto', py: { xs: 1, sm: 3 } }}>
          <Stack direction="row" alignItems="center" gap={1.25} sx={{ mb: 1.25 }}><AutoAwesomeRoundedIcon sx={{ fontSize: 22, color: 'primary.main' }} /><Typography variant="h6">{chosenSpecialist ? 'Talk to your ' + chosenSpecialist.name.toLowerCase() : 'Where would you like to start?'}</Typography></Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5, maxWidth: 640 }}>
            {chosenSpecialist?.description ?? 'Your financial adviser coordinates focused reviews and brings them into one ordered plan. Start with a question, or choose a specialist above.'}
          </Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(3, minmax(0, 1fr))' }, gap: 1 }}>
            {chosenSpecialist ? startingQuestions.map(question => <Button key={question} variant="outlined" size="small" onClick={() => void sendMessage(question)}
              disabled={busy} sx={{ justifyContent: 'flex-start', py: 1.5, px: 1.5, minWidth: 0, textAlign: 'left' }}>{question}</Button>)
              : QUICK_PROMPTS.map(prompt => <Button key={prompt.label} variant="outlined" size="small" startIcon={prompt.icon} onClick={() => void sendMessage(prompt.prompt)}
                disabled={busy} sx={{ justifyContent: 'flex-start', py: 1.5, px: 1.5, minWidth: 0, textAlign: 'left' }}>{prompt.label}</Button>)}
          </Box>
        </Box> : <Stack spacing={2}>
          {messages.map((message, index) => <Paper key={index} elevation={0} sx={{
            p: { xs: 1.5, sm: 2 }, minWidth: 0, width: message.role === 'assistant' ? { xs: '100%', sm: '94%' } : 'auto', maxWidth: '100%', overflowWrap: 'anywhere',
            alignSelf: message.role === 'user' ? 'flex-end' : 'flex-start', bgcolor: message.role === 'user' ? '#EDF7F5' : 'background.paper',
            border: 1, borderColor: message.role === 'user' ? '#D2E9E4' : 'divider', borderRadius: '8px',
          }}>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.75 }}>
              <Typography variant="caption" fontWeight={600}>{message.role === 'user' ? 'You' : message.metadata ? adviserModeName(message.metadata.specialistMode) : 'Financial adviser'}</Typography>
              {message.metadata?.status === 'interrupted' && <Chip size="small" label="Incomplete response" color="warning" variant="outlined" />}
            </Stack>
            {message.role === 'assistant' ? <>
              {message.content && <Box sx={markdownSx}><ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={markdownComponents}>{message.content}</ReactMarkdown></Box>}
              {message.metadata && <SpecialistReviews results={message.metadata.specialistResults} />}
            </> : <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>{message.content}</Typography>}
          </Paper>)}
          {activeTools.length > 0 && <Stack direction="row" gap={0.75} flexWrap="wrap" alignItems="center" aria-live="polite">
            <MemoryRoundedIcon sx={{ fontSize: 16, color: 'primary.main' }} />{activeTools.map((label, index) => <Chip key={index} label={label} size="small" variant="outlined" />)}
          </Stack>}
          {(streamingContent || liveResults.length > 0 || pendingSpecialists.length > 0) && <Paper elevation={0} sx={{ p: { xs: 1.5, sm: 2 }, width: { xs: '100%', sm: '94%' }, minWidth: 0, alignSelf: 'flex-start', border: 1, borderColor: 'divider', borderRadius: '8px' }}>
            <Typography variant="caption" sx={{ display: 'block', fontWeight: 600, mb: 0.75 }}>{adviserModeName(selectedMode)}</Typography>
            {streamingContent && <Box sx={markdownSx}><ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={markdownComponents}>{streamingContent}</ReactMarkdown></Box>}
            <SpecialistReviews results={liveResults} pending={pendingSpecialists} />
          </Paper>}
          {loading && !streamingContent && activeTools.length === 0 && pendingSpecialists.length === 0 && liveResults.length === 0 && <Stack direction="row" gap={1} alignItems="center" aria-live="polite"><CircularProgress size={16} /><Typography variant="body2" color="text.secondary">Reviewing your question…</Typography></Stack>}
        </Stack>}
      </Box>

      <Box sx={{ flexShrink: 0, borderTop: 1, borderColor: 'divider', p: { xs: 1.5, sm: 2 }, bgcolor: 'background.paper' }}>
        <ChatCategorizationProgress />
        {sendError && <ChatFailureNotice failure={sendError} />}
        <Stack direction="row" gap={1} alignItems="flex-end" sx={{ border: 1, borderColor: 'divider', borderRadius: '6px', p: 0.5, minWidth: 0 }}>
          <TextField fullWidth multiline minRows={1} maxRows={4} size="small" placeholder={selectedMode === 'team' ? 'Ask about your finances…' : 'Ask your ' + adviserModeName(selectedMode).toLowerCase() + '…'} value={input} onChange={event => setInput(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void sendMessage(input); } }}
            disabled={busy} inputProps={{ 'aria-label': 'Message your financial adviser', maxLength: 20000 }}
            sx={{ minWidth: 0, '& .MuiOutlinedInput-notchedOutline': { border: 'none' } }} />
          {loading ? <IconButton aria-label="Stop response" onClick={() => requestController.current?.abort()} color="primary" sx={{ flexShrink: 0 }}><StopRoundedIcon sx={{ fontSize: 20 }} /></IconButton>
            : <IconButton aria-label="Send message" color="primary" onClick={() => void sendMessage(input)} disabled={busy || !input.trim()}
              sx={{ flexShrink: 0, borderRadius: '5px', bgcolor: input.trim() ? theme => alpha(theme.palette.primary.main, 0.08) : 'transparent' }}><SendRoundedIcon sx={{ fontSize: 20 }} /></IconButton>}
        </Stack>
        <Typography variant="caption" sx={{ display: 'block', mt: 1, textAlign: 'center', fontSize: '0.6875rem' }}>AI planning information. Review the evidence and assumptions before acting.</Typography>
      </Box>
    </Paper>
  </Box>;
}
