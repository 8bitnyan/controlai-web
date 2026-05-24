'use client';

import { useEffect } from 'react';

interface GlobalErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/**
 * Global error boundary — catches crashes in the root layout.
 * Must render minimal HTML (no root layout wrappers are available).
 */
export default function GlobalError({ error, reset }: GlobalErrorProps) {
  useEffect(() => {
    console.error('[global-error-boundary]', error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          display: 'flex',
          minHeight: '100vh',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#0f0f0f',
          color: '#f5f5f5',
          fontFamily: 'system-ui, sans-serif',
          margin: 0,
          padding: '1rem',
        }}
      >
        <div
          style={{
            maxWidth: 480,
            width: '100%',
            border: '1px solid #333',
            borderRadius: 8,
            padding: '2rem',
            textAlign: 'center',
          }}
        >
          <h1 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>
            Something went wrong
          </h1>
          <p style={{ color: '#999', marginBottom: '1.5rem', fontSize: '0.875rem' }}>
            A critical error occurred. Please refresh the page or contact support if
            the problem persists.
            {error.digest && (
              <>
                <br />
                <code style={{ fontSize: '0.75rem' }}>Error ID: {error.digest}</code>
              </>
            )}
          </p>
          <button
            onClick={reset}
            style={{
              padding: '0.5rem 1.5rem',
              backgroundColor: '#3b82f6',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
              fontSize: '0.875rem',
            }}
          >
            Reload page
          </button>
        </div>
      </body>
    </html>
  );
}
