import { redirect } from 'next/navigation';

// /chat is now part of /messages (the unified Messages hub). Permanent
// redirect so any old bookmark or link still lands on the right place.
export default function ChatPage() {
  redirect('/messages?view=general');
}
