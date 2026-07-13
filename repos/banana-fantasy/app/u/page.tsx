'use client';

import Link from 'next/link';
import { UserSearchBox } from '@/app/components/marketplace/UserSearchBox';

// Bare /u entry — type a username or wallet to see all the teams that person
// owns. The search box suggests users as you type and routes to /u/[id].
export default function UserLookupPage() {
  return (
    <div className="w-full px-4 sm:px-8 lg:px-12 py-8">
      <div className="max-w-2xl mx-auto">
        <Link href="/marketplace" className="text-text-muted text-sm hover:text-text-primary transition-colors">← Back to Marketplace</Link>

        <h1 className="mt-4 text-2xl font-semibold tracking-tight text-text-primary">Find a user</h1>
        <p className="text-text-muted text-sm mt-1">Enter a username or wallet to see all the teams that person owns.</p>

        <div className="mt-5">
          <UserSearchBox autoFocus />
        </div>
      </div>
    </div>
  );
}
