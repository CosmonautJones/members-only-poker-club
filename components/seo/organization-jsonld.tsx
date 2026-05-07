import { JsonLd } from "./json-ld";
import { NAP } from "@/lib/content/nap";

/**
 * Organization JSON-LD payload, mounted on the marketing home page (`/`).
 *
 * Acceptance criterion 5 of ADR-0030 (`docs/specs/0030-...md`) requires
 * an Organization schema on the home page so brand search panels and
 * knowledge-graph consumers can attach the venue identity to the domain.
 *
 * `url`, `logo`, and `sameAs` are placeholder values — real domain, logo
 * asset, and social profiles land before public launch (see `TODO(travis)`
 * comments below). The `name` is sourced from the canonical NAP module
 * (`lib/content/nap.ts`) so the JSON-LD stays consistent with the
 * LocalBusiness payload at `/contact` and any future footer / GBP feed.
 */
export function OrganizationJsonLd() {
  const data = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: NAP.name,
    url: "https://example.com", // TODO(travis): set canonical domain when known
    logo: "https://example.com/logo.png", // TODO(travis): point at real logo asset
    sameAs: [
      // TODO(travis): add real social links (Facebook, Instagram, etc.) when established
    ],
  };
  return <JsonLd data={data} />;
}
