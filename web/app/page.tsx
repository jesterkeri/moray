'use client';

import { usePrivy } from '@privy-io/react-auth';
import { AppFrame } from '@/components/AppFrame';
import { Landing } from '@/components/Landing';
import { Dashboard } from '@/components/Dashboard';

export default function Home() {
  const { ready, authenticated } = usePrivy();

  return (
    <AppFrame view={authenticated ? 'app' : 'landing'}>
      {!ready ? (
        <div className="fullscreen-center">
          <div className="spinner" />
        </div>
      ) : authenticated ? (
        <Dashboard />
      ) : (
        <Landing />
      )}
    </AppFrame>
  );
}
