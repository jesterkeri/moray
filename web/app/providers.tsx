'use client';

import { PrivyProvider } from '@privy-io/react-auth';
import { WagmiProvider } from '@privy-io/wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { wagmiConfig } from '@/lib/wagmi';
import { privyConfig } from '@/lib/privyConfig';

const queryClient = new QueryClient();

export default function Providers({ children }: { children: React.ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

  // Fail closed: no silent degraded mode. If auth isn't configured, say so.
  if (!appId) {
    return <SetupNotice />;
  }

  return (
    <PrivyProvider appId={appId} config={privyConfig}>
      <QueryClientProvider client={queryClient}>
        <WagmiProvider config={wagmiConfig}>{children}</WagmiProvider>
      </QueryClientProvider>
    </PrivyProvider>
  );
}

function SetupNotice() {
  return (
    <main
      style={{
        minHeight: '100dvh',
        display: 'grid',
        placeItems: 'center',
        padding: 24,
      }}
    >
      <div className="card card-pad" style={{ maxWidth: 440 }}>
        <div className="eyebrow" style={{ marginBottom: 10 }}>
          Setup required
        </div>
        <h1 className="h-title" style={{ marginBottom: 8 }}>
          Moray isn&apos;t configured yet
        </h1>
        <p className="muted" style={{ marginBottom: 16 }}>
          Set <span className="mono">NEXT_PUBLIC_PRIVY_APP_ID</span> in{' '}
          <span className="mono">web/.env.local</span> with an app id from{' '}
          <a href="https://dashboard.privy.io" style={{ color: 'var(--accent)' }}>
            dashboard.privy.io
          </a>
          , then restart the dev server.
        </p>
        <p className="muted" style={{ fontSize: 13 }}>
          Also set <span className="mono">NEXT_PUBLIC_MORAY_ADDRESS</span> once the
          vault is deployed to Monad testnet.
        </p>
      </div>
    </main>
  );
}
