'use client';

import { Suspense } from 'react';
import { MessagesHub } from '@/components/messages/MessagesHub';

export default function MessagesPage() {
  return (
    <main className="min-h-screen">
      <Suspense fallback={null}>
        <MessagesHub />
      </Suspense>
    </main>
  );
}
