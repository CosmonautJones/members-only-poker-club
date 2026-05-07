import "server-only";

type JsonLdProps<T = unknown> = {
  data: T;
};

/**
 * Reusable JSON-LD building block. Renders a `<script type="application/ld+json">`
 * tag whose body is the JSON-stringified `data` prop.
 *
 * Security note: this component uses `dangerouslySetInnerHTML` to inject the
 * JSON payload. That is the documented Next.js / React App Router pattern for
 * structured-data tags (see Next.js metadata docs). It is safe HERE because:
 *   1. The `data` prop is owner-controlled static content (NAP, Organization
 *      schema, Tournament fixtures) — never user-submitted input.
 *   2. `JSON.stringify` produces output that, when placed inside a
 *      `<script type="application/ld+json">` block, cannot break out into
 *      executable script context — only `</script>` sequences in string values
 *      could escape the tag, and our static content does not contain them.
 *   3. The MIME type `application/ld+json` is non-executable; browsers do not
 *      run it as JavaScript.
 *
 * If this component is ever extended to accept user-controlled data, add a
 * `</script>` escape pass before serialisation. See ADR-0030 §Consequences.
 */
export function JsonLd<T>({ data }: JsonLdProps<T>) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
