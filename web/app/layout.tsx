import type { Metadata } from 'next';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import Providers from './providers';
import './globals.css';

export const metadata: Metadata = {
  title: 'Moray — the self-custodial safe',
  description:
    "Bank-grade protection, you hold the keys. A self-custodial safe for the crypto you can't afford to lose.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
