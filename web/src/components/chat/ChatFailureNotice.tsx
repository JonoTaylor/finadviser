'use client';

import { Alert, Typography } from '@mui/material';
import { chatFailurePresentation, type ChatFailure } from './chat-failure';

export default function ChatFailureNotice({ failure }: { failure: ChatFailure }) {
  const presentation = chatFailurePresentation(failure);
  return <Alert severity="warning" sx={{ mb: 1.5 }}>
    <Typography variant="body2">{presentation.message}</Typography>
    <Typography variant="body2" sx={{ mt: 0.5 }}>{presentation.guidance}</Typography>
    {presentation.requestId && <Typography variant="caption" component="p" sx={{ mt: 0.5 }}>Reference: {presentation.requestId}</Typography>}
  </Alert>;
}
