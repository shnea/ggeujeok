import { redirect } from 'next/navigation';

// Keep old bookmarks usable after moving profile setup to the platform.
export default function NicknamePage() { redirect('/login'); }
