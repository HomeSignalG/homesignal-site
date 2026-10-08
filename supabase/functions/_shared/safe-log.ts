// safe-log — one fixed-text log line per request, for the report and billing functions (audit fix 9, 2026-10-07).
//
// WHY: these functions logged nothing, so a failing report or a refused payment event left no trace anyone could read. This wraps a handler and
// writes exactly ONE line per request: the function's own name, the HTTP status it answered with, how long it took, and (when the handler threw)
// the fixed word "threw". NOTHING ELSE. Never the request, its URL (a share link carries a secret), a header, an address, a client label, an
// email, an error message (it can quote input) or the response body. A line built from only a function name, a number and a fixed word cannot
// hold a street address however a caller misuses it.
//
// PURE: it takes the sink and the clock as arguments and touches no global, so the real `console.log` is handed in by index.ts only (the one
// wiring file allowed to reach the outside), and a test can hand in an array.
type Handler = (req: Request) => Promise<Response> | Response;

export function safeLogLine(name: string, status: number | null, ms: number, threw: boolean): string {
  const n = String(name).replace(/[^a-z0-9-]/gi, '').slice(0, 60);
  const st = typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599 ? String(status) : 'none';
  const t = Number.isFinite(ms) ? String(Math.max(0, Math.min(Math.round(ms), 600000))) : '0';
  return '[' + n + '] status=' + st + ' ms=' + t + (threw ? ' threw' : '');
}

export function withSafeLog(name: string, handler: Handler, sink: (line: string) => void, now: () => number): Handler {
  return async (req: Request) => {
    const t0 = now();
    let res: Response;
    try {
      res = await handler(req);
    } catch (_e) {
      try { sink(safeLogLine(name, null, now() - t0, true)); } catch { /* a log that fails never changes the answer */ }
      throw _e; // the platform answers 500 exactly as it did before
    }
    try { sink(safeLogLine(name, res.status, now() - t0, false)); } catch { /* same */ }
    return res;
  };
}
