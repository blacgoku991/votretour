import { SiteHeader, SiteFooter } from '@/components/SiteChrome';

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100dvh' }}>
      <SiteHeader />
      {children}
      <SiteFooter />
    </div>
  );
}
