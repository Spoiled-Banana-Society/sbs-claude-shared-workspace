import { redirect } from 'next/navigation';

// /friends is now part of /messages (the unified Messages hub). Permanent
// redirect so any old bookmark or link still lands on the right place.
export default function FriendsPage() {
  redirect('/messages?view=friends');
}
