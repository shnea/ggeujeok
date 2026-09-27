'use client';
import { Monitor, Sun, Moon } from 'lucide-react';
import { useEffect, useState } from 'react';

type Theme = 'system' | 'light' | 'dark';
const isTheme = (value: string | null): value is Theme => value === 'light' || value === 'dark' || value === 'system';

export function ThemeSelect() {
  const [theme, setTheme] = useState<Theme>('system');
  useEffect(() => {
    const value = document.documentElement.dataset.theme || 'system';
    if (isTheme(value)) setTheme(value);
    const sync = (event: StorageEvent) => {
      if (event.key !== 'ggeujeok-theme' && event.key !== null) return;
      const next = isTheme(event.newValue) ? event.newValue : 'system';
      document.documentElement.dataset.theme = next;
      setTheme(next);
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  const choices = [
    { value: 'system', label: '시스템 테마', Icon: Monitor },
    { value: 'light', label: '밝은 테마', Icon: Sun },
    { value: 'dark', label: '어두운 테마', Icon: Moon },
  ] as const;
  return <div className="theme-select" role="group" aria-label="화면 테마">
    {choices.map(({ value, label, Icon }) => <button key={value} type="button" aria-label={label} title={label}
      aria-pressed={theme === value} onClick={() => {
        document.documentElement.dataset.theme = value;
        setTheme(value);
        try { localStorage.setItem('ggeujeok-theme', value); } catch { /* Keep the selection when storage is blocked. */ }
      }}><Icon aria-hidden="true" /></button>)}
  </div>;
}
