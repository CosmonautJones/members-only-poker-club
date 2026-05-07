/**
 * Public marketing route group layout.
 *
 * Wraps every page under `app/(marketing)/*` with the public header
 * and footer. Inherits fonts and metadata from the root layout.
 */

import { PublicFooter } from '@/components/marketing/public-footer';
import { PublicHeader } from '@/components/marketing/public-header';

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PublicHeader />
      <main>{children}</main>
      <PublicFooter />
    </>
  );
}
