// TODO(travis): legal review before public launch.
// Banner + customize-panel copy is engineering-authored placeholder text.
// Counsel must review per ADR-0024 Open Question 1 and 2.

export const COPY = {
  banner: {
    title: 'Cookies',
    body: 'We use cookies to keep you signed in and to learn how the site is used. You decide what we collect.',
    accept_all: 'Accept all',
    essential_only: 'Essential only',
    customize: 'Customize',
  },
  customize: {
    title: 'Cookie preferences',
    description: 'Choose which cookies we set when you use the site.',
    categories: {
      essential: {
        name: 'Essential',
        description: 'Required for sign-in and security. Always on.',
      },
      analytics: {
        name: 'Analytics',
        description: 'Helps us understand how the site is used. PostHog.',
      },
      errors: {
        name: 'Error tracking',
        description: 'Reports JavaScript errors so we can fix bugs. Sentry.',
      },
    },
    save: 'Save preferences',
    cancel: 'Cancel',
  },
  footer_link: 'Cookie preferences',
  policy_link: 'Privacy policy',
} as const;

export type ConsentCopy = typeof COPY;
