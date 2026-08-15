// pg-pages.ts — range-windowed full read for the engine's PostgREST queries.
//
// THE FAILURE CLASS THIS REMOVES. A bare .limit(N) silently truncates at N with nothing
// failing: the devSites alerts read shipped with .limit(100), so Taos County rendered 100
// of its 101 stored notices and Weber County 100 of 283 — same class as the PostgREST
// 1,000-row default cap that bit the site-side verifiers (lib/data.js::fetchAllPages is
// this exact contract on the browser side).
//
// CONTRACT (mirrors fetchAllPages):
//   • The caller's order MUST be TOTAL (e.g. published_at desc + id tiebreak) so windows
//     never skip or repeat a row.
//   • One retry per window; a window that still fails THROWS. Failing loud is the point:
//     the report request fails, the refresh layer's transient-safe upsert keeps the
//     previous cached row, and nobody serves a silent prefix as if it were the full set.
//     (The old read also failed SILENT-EMPTY on error — `const { data } = ...` dropped
//     the error object — so this replaces two silent failure modes, not one.)
export async function readAllRows<T>(
  build: () => { range(from: number, to: number): PromiseLike<{ data: T[] | null; error: unknown }> },
  pageRows = 1000,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += pageRows) {
    let { data, error } = await build().range(from, from + pageRows - 1);
    if (error || !data) ({ data, error } = await build().range(from, from + pageRows - 1));
    if (error || !data) {
      throw new Error(`readAllRows: window ${from}-${from + pageRows - 1} failed after retry: ` +
        String((error as { message?: string })?.message ?? JSON.stringify(error)).slice(0, 300));
    }
    for (const r of data) rows.push(r);
    if (data.length < pageRows) return rows;
  }
}
