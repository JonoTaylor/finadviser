'use client';

import { useEffect } from 'react';

/**
 * Last-resort boundary for failures in the root layout itself. It replaces
 * the layout, so the theme is unavailable and styles are inline.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('Application shell failed to render', error);
  }, [error]);

  return <html lang="en">
    <body style={{ margin: 0, minHeight: '100vh', background: '#F5F7FA', color: '#0F172A', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
      <main style={{ maxWidth: 560, margin: '0 auto', padding: '64px 16px' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 650, margin: '0 0 12px' }}>FinAdviser could not load</h1>
        <p style={{ fontSize: '0.9375rem', lineHeight: 1.6, color: '#475569', margin: '0 0 24px' }}>
          Something went wrong while starting the app. Your saved financial data has not been changed.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" onClick={() => reset()} style={{ font: 'inherit', fontWeight: 600, padding: '8px 16px', borderRadius: 8, border: 0, background: '#0F766E', color: '#FFFFFF', cursor: 'pointer' }}>
            Try again
          </button>
          {/* A full reload is deliberate: client navigation depends on the layout that failed. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/" style={{ fontWeight: 600, padding: '8px 16px', borderRadius: 8, border: '1px solid #E2E8F0', background: '#FFFFFF', color: '#0F172A', textDecoration: 'none' }}>
            Reload the overview
          </a>
        </div>
        {error.digest && <p style={{ fontSize: '0.75rem', color: '#5F6E83', marginTop: 24 }}>Reference {error.digest}</p>}
      </main>
    </body>
  </html>;
}
