'use client';

import { Suspense } from 'react';
import { MessagesView } from '@/components/messages/MessagesView';

export default function MessagesPage() {
  return (
    <main className="min-h-screen">
      <Suspense fallback={null}>
        <MessagesView />
      </Suspense>
    </main>
  );
}
