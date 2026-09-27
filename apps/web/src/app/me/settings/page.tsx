import type { Metadata } from 'next';
import { ProfileSettings } from './profile-settings';

export const metadata: Metadata = { title: '내 설정', robots: { index: false, follow: false } };
export default function SettingsPage() { return <ProfileSettings />; }
