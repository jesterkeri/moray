import { TopBar } from './TopBar';

export function AppFrame({
  view = 'landing',
  children,
}: {
  view?: 'landing' | 'app';
  children: React.ReactNode;
}) {
  return (
    <div className="moray-shell" data-view={view}>
      <TopBar />
      <main style={{ flex: 1 }}>{children}</main>
    </div>
  );
}
