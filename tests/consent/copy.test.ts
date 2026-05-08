import { describe, it, expect } from 'vitest';
import { COPY } from '@/lib/consent/copy';

describe('COPY module', () => {
  it('exports banner copy with all 5 keys', () => {
    expect(COPY.banner.title).toBeTruthy();
    expect(COPY.banner.body).toBeTruthy();
    expect(COPY.banner.accept_all).toBeTruthy();
    expect(COPY.banner.essential_only).toBeTruthy();
    expect(COPY.banner.customize).toBeTruthy();
  });

  it('exports customize panel copy with category descriptions', () => {
    expect(COPY.customize.title).toBeTruthy();
    expect(COPY.customize.description).toBeTruthy();
    expect(COPY.customize.categories.essential.name).toBeTruthy();
    expect(COPY.customize.categories.analytics.name).toBeTruthy();
    expect(COPY.customize.categories.errors.name).toBeTruthy();
    expect(COPY.customize.save).toBeTruthy();
    expect(COPY.customize.cancel).toBeTruthy();
  });

  it('exports footer link label', () => {
    expect(COPY.footer_link).toBeTruthy();
  });
});
