/**
 * /accessibility — accessibility statement page (ADR-0026 slice 1).
 *
 * Plain-language statement of what WCAG level we target, the practices we
 * follow, and how a member can report an issue. Slice 4 adds the formal
 * audit results section.
 */
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Accessibility',
  description:
    'Accessibility statement for Members Only Poker Social Club: WCAG 2.1 Level AA target, the practices we follow, and how to report an issue.',
  openGraph: {
    title: 'Accessibility',
    description:
      'Accessibility statement for Members Only Poker Social Club: WCAG 2.1 Level AA target, the practices we follow, and how to report an issue.',
    images: [
      {
        url: '/og?title=Accessibility&subtitle=Members%20Only%20Poker%20Social%20Club',
        width: 1200,
        height: 630,
        alt: 'Members Only Poker Social Club — Accessibility',
      },
    ],
  },
};

export default function AccessibilityPage(): JSX.Element {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="font-serif text-4xl">Accessibility</h1>

      <p className="mt-4 text-lg">
        We&rsquo;re committed to making our site usable by every member. Our target is{' '}
        <a
          className="underline"
          href="https://www.w3.org/WAI/WCAG21/quickref/?currentsidebar=%23col_overview&amp;levels=aa"
          rel="noreferrer"
          target="_blank"
        >
          WCAG 2.1 Level AA
        </a>{' '}
        across every member-facing page.
      </p>

      <h2 className="mt-10 font-serif text-2xl">What we do</h2>
      <ul className="mt-3 list-disc space-y-2 pl-6">
        <li>
          <strong>Semantic HTML.</strong> Buttons are <code>&lt;button&gt;</code>, links are{' '}
          <code>&lt;a&gt;</code>, navigation is <code>&lt;nav&gt;</code>. We don&rsquo;t use{' '}
          <code>&lt;div&gt;</code> or <code>&lt;span&gt;</code> as actionable elements.
        </li>
        <li>
          <strong>Visible focus.</strong> Every interactive element shows a visible focus ring when
          tabbed to.
        </li>
        <li>
          <strong>Color contrast.</strong> Body text meets 4.5:1 contrast against the background.
          Our gold-on-black palette was chosen with this in mind.
        </li>
        <li>
          <strong>Keyboard navigation.</strong> Every flow on the site can be completed using only
          the keyboard. Tab order matches the visual order.
        </li>
        <li>
          <strong>Screen readers.</strong> Icon-only buttons carry <code>aria-label</code>.
          Important changes (e.g., &ldquo;Time top-up successful&rdquo;) announce via{' '}
          <code>aria-live</code>.
        </li>
        <li>
          <strong>Forms.</strong> Every input has an associated label; error messages are tied to
          the input via <code>aria-describedby</code> and announced when validation fires.
        </li>
        <li>
          <strong>Motion.</strong> We respect the operating system&rsquo;s{' '}
          <code>prefers-reduced-motion</code> setting and disable shimmer, marquee tickers, and
          grain effects when it&rsquo;s on.
        </li>
        <li>
          <strong>Imagery.</strong> Meaningful images carry alt text; decorative images are marked{' '}
          <code>alt=&quot;&quot;</code> so screen readers skip them.
        </li>
        <li>
          <strong>Document outline.</strong> One <code>&lt;h1&gt;</code> per page. Heading hierarchy
          is unbroken so screen-reader users can navigate by structure.
        </li>
      </ul>

      <h2 className="mt-10 font-serif text-2xl">Reporting an issue</h2>
      <p className="mt-3">
        If something on this site isn&rsquo;t accessible to you, please email{' '}
        <a className="underline" href="mailto:members@membersonlypokerclub.com">
          members@membersonlypokerclub.com
        </a>{' '}
        with the page URL, what device and browser you were using, and what wasn&rsquo;t working. We
        respond within one business day for accessibility-related issues.
      </p>

      <h2 className="mt-10 font-serif text-2xl">Audit history</h2>
      <p className="mt-3 italic text-stone-300">
        Slice 4 will add the results of our first formal audit (manual keyboard-only walkthrough +
        screen-reader pass on every critical flow) to this section.
      </p>
    </main>
  );
}
