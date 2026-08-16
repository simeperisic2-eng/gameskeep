/**
 * Safe schema.org JSON-LD emitter (I6 security review #2).
 *
 * `JSON.stringify` leaves `<`, `>` and `&` intact, so ANY string that reaches a
 * value — e.g. a reflected `?genre=` filter echoed into an ItemList `name` —
 * could contain `</script><script>…` and break out of this inline element
 * (there is no CSP strong enough to catch inline injection without nonces).
 * Escaping those characters to their `\uXXXX` forms keeps the payload INSIDE the
 * JSON string literal, so it renders as inert text. This is the single shared
 * emit path — every `application/ld+json` block on the site goes through it.
 * U+2028/U+2029 are escaped too (valid in JSON, but break inline scripts).
 */
const LINE_SEP = new RegExp(String.fromCharCode(0x2028), 'g');
const PARA_SEP = new RegExp(String.fromCharCode(0x2029), 'g');

export function JsonLd({ data }: { data: unknown }): React.JSX.Element {
  const json = JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(LINE_SEP, '\\u2028')
    .replace(PARA_SEP, '\\u2029');
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
}
