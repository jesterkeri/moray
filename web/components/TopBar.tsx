'use client';

import { usePrivy } from '@privy-io/react-auth';
import { MorayMark, Wordmark } from './MorayMark';
import { ThemeToggle } from './ThemeToggle';
import { LogOutIcon } from './icons';
import { shortAddress } from '@/lib/moray';

export function TopBar() {
  const { authenticated, user, logout, login, ready } = usePrivy();
  const label = user?.email?.address ?? shortAddress(user?.wallet?.address);

  return (
    <header className="moray-topbar">
      <div className="moray-topbar-inner">
        <div className="row gap-3">
          <MorayMark size={34} />
          <Wordmark />
        </div>

        <div className="row gap-4">
          {!authenticated && (
            <button
              className="bracket-btn nav-cta"
              disabled={!ready}
              onClick={() => login()}
            >
              Enter your safe
            </button>
          )}
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
      </div>
    </header>
  );
}
