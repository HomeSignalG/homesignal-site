// One fetch attempt for the registry connectors' backoff loops (arcgis, socrata, ckan, carto).
//
// WHY (2026-10-20, Oregon pre-launch). Each connector's getWithBackoff retried HTTP 429/5xx but let a
// CONNECTION-LEVEL failure throw straight out, so a single reset failed the whole source for that ZIP.
// Measured on dev_refresh_source_failures: portland-building-permits failed 192 times on 79 ZIP pages
// between 2026-10-06 and 2026-10-20, every one "Connection reset by peer", and 100 of those blocked a
// write (Multnomah: 19 of 34 pages attempted and not written, oldest successful write 11 days old).
// The same host answered from Postgres pg_net at the same time, so the reset is intermittent.
//
// RULE. A thrown fetch is retried only when it is a connection failure (Deno raises TypeError). A
// timeout (AbortSignal.timeout → TimeoutError) or an abort is NOT retried: each attempt already waits
// 30 s, and four of them would spend the report's whole 60 s core budget on one slow host.

export type AttemptResult = { res: Response } | { retry: Error };

/** True for a connection-level fetch failure worth another attempt; false for a timeout or abort. */
export function isRetryableNetworkError(err: unknown): boolean {
  const name = (err as { name?: unknown } | null)?.name;
  if (name === "TimeoutError" || name === "AbortError") return false;
  return err instanceof TypeError;
}

/** Run one attempt. A retryable connection failure comes back as `{ retry }`; anything else
 *  (including a timeout) is re-thrown unchanged, exactly as before. */
export async function attemptFetch(doFetch: () => Promise<Response>): Promise<AttemptResult> {
  try {
    return { res: await doFetch() };
  } catch (err) {
    if (isRetryableNetworkError(err)) return { retry: err as Error };
    throw err;
  }
}
