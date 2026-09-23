import { SiteHeader, SiteFooter } from '@/components/SiteChrome';
import { hasLegalNotice } from '@/lib/legal';

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100dvh' }}>
      <SiteHeader />
      {children}
      <SiteFooter legalNotice={hasLegalNotice()} />
    </div>
  );
}
