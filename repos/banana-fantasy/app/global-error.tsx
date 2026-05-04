"use client";


import { useEffect } from "react";
import * as Sentry from '@sentry/nextjs';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Error caught by boundary:', error);
    try {
      Sentry.captureException(error);
    } catch {}
  }, [error]);

  return (
    <html>
      <body
        style={{
          backgroundColor: "#0a0a0f",
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, -apple-system, sans-serif",
          color: "#ffffff",
        }}
      >
        <div style={{ textAlign: "center", padding: "2rem", maxWidth: "400px" }}>
          <h2 style={{ fontSize: "1.5rem", marginBottom: "1rem" }}>
            Something went wrong!
          </h2>
          <p style={{ color: "#999", marginBottom: "1.5rem" }}>
            An unexpected error occurred. Our team has been notified.
          </p>
          <button
            onClick={() => reset()}
            style={{
              backgroundColor: "#F3E216",
              color: "#0a0a0f",
              border: "none",
              padding: "0.75rem 1.5rem",
              borderRadius: "0.5rem",
              fontSize: "1rem",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Try Again
          </button>
        </div>
      </body>
    </html>
  );
}
