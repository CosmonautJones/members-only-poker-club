export type ConsentCategoryState = boolean;

export type ConsentState = {
  essential: true; // literal true — Essential is locked at the type level
  analytics: ConsentCategoryState;
  errors: ConsentCategoryState;
  version: 1;
};

const COOKIE_NAME = 'mopc-consent';
const COOKIE_MAX_AGE_SECONDS = 31_536_000; // 1 year

function isBrowser(): boolean {
  return typeof document !== 'undefined';
}

export function readConsent(): ConsentState | null {
  if (!isBrowser()) return null;
  const raw = document.cookie.split('; ').find((c) => c.startsWith(`${COOKIE_NAME}=`));
  if (!raw) return null;
  const value = decodeURIComponent(raw.slice(COOKIE_NAME.length + 1));
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!isValidConsentState(parsed)) return null;
  return parsed;
}

export function writeConsent(state: ConsentState): void {
  if (!isBrowser()) return;
  if (state.essential !== true) {
    throw new Error('Essential consent is locked and must remain true');
  }
  const encoded = encodeURIComponent(JSON.stringify(state));
  const attrs = [
    `${COOKIE_NAME}=${encoded}`,
    'Path=/',
    `Max-Age=${COOKIE_MAX_AGE_SECONDS}`,
    'SameSite=Lax',
  ];
  if (process.env.NODE_ENV === 'production') {
    attrs.push('Secure');
  }
  document.cookie = attrs.join('; ');
}

export function clearConsent(): void {
  if (!isBrowser()) return;
  const attrs = [`${COOKIE_NAME}=`, 'Path=/', 'Max-Age=0', 'SameSite=Lax'];
  if (process.env.NODE_ENV === 'production') {
    attrs.push('Secure');
  }
  document.cookie = attrs.join('; ');
}

function isValidConsentState(value: unknown): value is ConsentState {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.essential === true &&
    typeof v.analytics === 'boolean' &&
    typeof v.errors === 'boolean' &&
    v.version === 1
  );
}
