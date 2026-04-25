'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@mui/material';
import LogoutIcon from '@mui/icons-material/Logout';

export default function LogoutButton({ size = 'small' }: { size?: 'small' | 'medium' | 'large' }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  const handle = async () => {
    setSubmitting(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      setSubmitting(false);
      // Hard navigate so SWR caches and any in-memory state are cleared.
      window.location.href = '/login';
    }
  };

  return (
    <Button
      onClick={handle}
      size={size}
      startIcon={<LogoutIcon />}
      color="inherit"
      disabled={submitting}
    >
      {submitting ? 'Signing out…' : 'Sign out'}
    </Button>
  );
}
