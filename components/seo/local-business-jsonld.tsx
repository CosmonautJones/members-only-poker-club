import { JsonLd } from './json-ld';
import { NAP } from '@/lib/content/nap';

export function LocalBusinessJsonLd() {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: NAP.name,
    address: {
      '@type': 'PostalAddress',
      streetAddress: NAP.address.streetAddress,
      addressLocality: NAP.address.addressLocality,
      addressRegion: NAP.address.addressRegion,
      postalCode: NAP.address.postalCode,
      addressCountry: NAP.address.addressCountry,
    },
    telephone: NAP.telephone,
    openingHoursSpecification: NAP.openingHoursSpecification,
  };
  return <JsonLd data={data} />;
}
