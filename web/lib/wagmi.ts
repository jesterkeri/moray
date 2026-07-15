import { http } from 'wagmi';
import { createConfig } from '@privy-io/wagmi';
import { monadTestnet } from './chain';

// NOTE: createConfig + WagmiProvider are imported from @privy-io/wagmi (drop-in
// replacements) so Privy drives wagmi's connector state for the embedded wallet.
export const wagmiConfig = createConfig({
  chains: [monadTestnet],
  transports: {
    [monadTestnet.id]: http(),
  },
});
