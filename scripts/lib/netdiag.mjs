/**
 * Connection-error diagnostics for every verify suite (S2 review, fix 4).
 *
 * Imported for its side effect at the top of each suite. It wraps the global
 * `fetch` — NO retries, ever: on a connection-level failure (reset, refused,
 * socket closed, "fetch failed", a body stream cut mid-read) it prints one
 * NETDIAG block — timestamp, method + URL, the error and its cause code, the
 * suite, `docker compose ps`, and the backend + frontend logs from 30 s before
 * the request started to 5 s after the failure — then rethrows the ORIGINAL
 * error unchanged. So a recurrence of the transient i8 ECONNRESET is
 * diagnosable from the ladder log alone.
 */
import { execSync } from 'node:child_process';

const CONN_RE =
  /ECONNRESET|ECONNREFUSED|ECONNABORTED|EPIPE|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|EAI_AGAIN|UND_ERR_SOCKET|UND_ERR_CONNECT_TIMEOUT|UND_ERR_HEADERS_TIMEOUT|UND_ERR_BODY_TIMEOUT|UND_ERR_CLOSED|socket hang up|other side closed|fetch failed|terminated/i;

/** A transport failure (not an HTTP status — those are answers, not errors). */
export function isConnectionError(err) {
  if (!err || typeof err !== 'object') return false;
  const cause = err.cause ?? {};
  return [err.code, err.message, cause.code, cause.message, cause.name].some(
    (x) => typeof x === 'string' && CONN_RE.test(x),
  );
}

function sh(cmd) {
  try {
    return execSync(cmd, {
      encoding: 'utf8',
      timeout: 20_000,
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 8 * 1024 * 1024,
    });
  } catch (e) {
    return `(${cmd} → ${String(e.message).split('\n')[0]})\n${e.stdout ?? ''}${e.stderr ?? ''}`;
  }
}

const LOG_TAIL_CHARS = 15_000;
/** Full blocks per process; later errors get one line each (a dead stack mustn't flood the log). */
const FULL_REPORTS = 5;
let reports = 0;

export function reportConnectionError(err, { method, url, startedAt, phase }) {
  const at = new Date();
  reports += 1;
  if (reports > FULL_REPORTS) {
    process.stderr.write(
      `NETDIAG #${reports} ${at.toISOString()} ${method} ${url} (${phase}): ${err?.cause?.code ?? err?.message}\n`,
    );
    return;
  }
  const since = new Date(startedAt.getTime() - 30_000).toISOString();
  const until = new Date(at.getTime() + 5_000).toISOString();
  const cause = err?.cause ?? {};
  const logs = (svc) => {
    const out = sh(
      `docker logs --timestamps --since ${since} --until ${until} gameskeep-${svc}-1 2>&1`,
    );
    return out.length > LOG_TAIL_CHARS ? `…(truncated)\n${out.slice(-LOG_TAIL_CHARS)}` : out;
  };
  const block = [
    '',
    '══════════ NETDIAG: connection error (no retry) ══════════',
    `time      ${at.toISOString()} (request started ${startedAt.toISOString()}, +${at.getTime() - startedAt.getTime()} ms)`,
    `request   ${method} ${url}`,
    `phase     ${phase}`,
    `error     ${err?.name ?? 'Error'}: ${err?.message ?? String(err)}`,
    `cause     ${cause.code ?? '-'} ${cause.name ?? ''} ${cause.message ?? ''}`.trimEnd(),
    `suite     ${process.argv[1] ?? '?'}`,
    '── docker compose ps ──',
    sh('docker compose -p gameskeep ps --all'),
    `── backend logs ${since} → ${until} ──`,
    logs('backend'),
    `── frontend logs ${since} → ${until} ──`,
    logs('frontend'),
    '══════════ /NETDIAG ══════════',
    '',
  ].join('\n');
  process.stderr.write(block);
}

const originalFetch = globalThis.fetch;
if (typeof originalFetch === 'function' && !originalFetch.__netdiag) {
  const diagFetch = async function diagFetch(input, init) {
    const startedAt = new Date();
    const method = String(init?.method ?? input?.method ?? 'GET').toUpperCase();
    const url = typeof input === 'string' ? input : (input?.url ?? String(input));
    let res;
    try {
      res = await originalFetch(input, init);
    } catch (err) {
      if (isConnectionError(err))
        reportConnectionError(err, { method, url, startedAt, phase: 'request' });
      throw err;
    }
    // A reset can also cut the BODY after the headers arrived.
    for (const m of ['text', 'json', 'arrayBuffer', 'blob']) {
      const read = res[m]?.bind(res);
      if (!read) continue;
      res[m] = async () => {
        try {
          return await read();
        } catch (err) {
          if (isConnectionError(err))
            reportConnectionError(err, { method, url, startedAt, phase: `body (${m})` });
          throw err;
        }
      };
    }
    return res;
  };
  diagFetch.__netdiag = true;
  globalThis.fetch = diagFetch;
}
