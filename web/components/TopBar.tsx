'use client';

import { usePrivy } from '@privy-io/react-auth';
import { MorayMark, Wordmark } from './MorayMark';
import { ThemeToggle } from './ThemeToggle';
import { LogOutIcon } from './icons';
import { shortAddress } from '@/lib/moray';

export function TopBar() {
  const { authenticated, user, logout } = usePrivy();
  const label = user?.email?.address ?? shortAddress(user?.wallet?.address);

  return (
    <header className="moray-topbar">
      <div className="row gap-3">
        <MorayMark />
        <Wordmark />
      </div>

      <div className="row gap-2">
        <ThemeToggle />
        {authenticated && (
          <>
            {label && <span className="badge">{label}</span>}
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => logout()}
              aria-label="Log out"
            >
              <LogOutIcon />
            </button>
          </>
        )}
      </div>
    </header>
  );
}
