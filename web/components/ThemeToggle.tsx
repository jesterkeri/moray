'use client';

import { useEffect, useState } from 'react';
import { SunIcon, MoonIcon } from './icons';

type Theme = 'dark' | 'light';

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('dark');

  useEffect(() => {
    const saved = localStorage.getItem('moray-theme') as Theme | null;
    const initial: Theme = saved ?? 'dark';
    setTheme(initial);
    document.documentElement.setAttribute('data-theme', initial);
  }, []);

  function toggle() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('moray-theme', next);
  }

  return (
    <button className="btn btn-ghost btn-sm" onClick={toggle} aria-label="Toggle color theme">
      {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}
