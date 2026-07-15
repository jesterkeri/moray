import { TopBar } from './TopBar';

export function AppFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="moray-shell">
      <TopBar />
      <main style={{ flex: 1 }}>{children}</main>
    </div>
  );
}
