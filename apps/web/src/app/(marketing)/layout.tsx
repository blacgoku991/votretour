import { SiteHeader, SiteFooter } from '@/components/SiteChrome';
import { siteFooterData } from '@/server/founders';

export default async function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100dvh' }}>
      <SiteHeader />
      {children}
      <SiteFooter {...await siteFooterData()} />
    </div>
  );
}
