'use client';

import { useEffect } from 'react';
import { installSessionRedirect } from '@/lib/auth/session-redirect';

/** Sends an expired session to sign-in instead of leaving every card broken. */
export default function SessionRedirect() {
  useEffect(() => installSessionRedirect(window), []);
  return null;
}
