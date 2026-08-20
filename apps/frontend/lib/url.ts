/**
 * Client/SSR URL safety helper (I8 review F4). Advertiser `ctaUrl` is validated
 * http(s)-only at the API boundary (packages/shared `httpUrl`), but React does
 * NOT sanitize `href` schemes — a `javascript:`/`data:` URL that reached the DB
 * by any future non-validated path would become clickable stored-XSS. This is
 * the belt-and-braces re-check at the render site: only ever emit an `href` for
 * an http(s) URL; anything else renders as plain, un-linked text.
 */
export function isHttpUrl(value: string | null | undefined): value is string {
  if (!value) return false;
  return /^https?:\/\//i.test(value.trim());
}
