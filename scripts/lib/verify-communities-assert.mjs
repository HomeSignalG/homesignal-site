// Pure assertion core for verify-communities.mjs — NO network, NO Playwright, NO imports.
//
// Extracted 2026-08-02 so the RACE GUARD can be driven offline. The guard shipped inside the
// walker loop, where its only branch needed a live REST round-trip to reach, so it could not be
// unit-tested — and its first production run reported "Rows re-read after a mid-walk materializer
// change: 0", i.e. it had never fired. A guard that has never fired is indistinguishable from a
// guard that cannot fire (CLAUDE.md: "an instrument must prove it ran before its silence counts
// as evidence"), so the comparison lives here as a pure function of
// (snapshot row, rendered page state, fetchFresh) and both outcomes are asserted in
// test/verify-communities-assert.test.mjs.

/** <meta name=robots> says index (and does not say noindex). */
export const indexable = (r) => /(^|[^n])index/i.test(r) && !/noindex/i.test(r);

/**
 * Assert one materialized community page against its materializer-stamped flags.
 *
 * @param {{zip:string,name:string,state:string,data_quality:string,indexable:boolean}} snapshot
 *        the row as read at the START of the walk (may be stale by the time the page is read)
 * @param {{robots:string,isPass:boolean,isCoverage:boolean,isNotCovered:boolean,h1:string,recordLinks:string[]}} st
 *        what the page actually rendered
 * @param {(zip:string)=>Promise<{data_quality:string,indexable:boolean}|null>} fetchFresh
 *        re-reads ONE row; only called when the snapshot and the page disagree
 * @returns {Promise<{fails:string[],notes:string[],reRead:boolean,row:object}>}
 */
export async function assertCommunityRow(snapshot, st, fetchFresh) {
  let row = snapshot;
  const fails = [];
  const notes = [];
  let reRead = false;
  const tag = `${row.state} ${row.zip} (${row.name})`;

  // ── RACE GUARD ──────────────────────────────────────────────────────────────────────────
  // The meta table is read ONCE up front and 12,722 pages are walked over the following ~20
  // minutes while the materializer keeps re-stamping rows on its own schedule. A row rewritten
  // mid-walk makes the snapshot disagree with a page that is in fact rendering the CURRENT flag
  // correctly.
  //   Observed: 97212 / 97221 / 97232 (Portland OR) all failed on run 30768231260, all three
  //   with updated_at 21:40:00 — inside a run that started 21:35 and read those pages after.
  //   Two had flipped true -> false and one false -> true, so the pages were right in BOTH
  //   directions and the snapshot was stale in both.
  // This never weakens the gate: a page that contradicts the CURRENT flag still fails, and every
  // substitution is reported so a re-read can never quietly become how a real defect is dismissed.
  if (row.data_quality === 'pass' && row.indexable !== indexable(st.robots) && fetchFresh) {
    const fresh = await fetchFresh(row.zip);
    if (fresh && (fresh.indexable !== row.indexable || fresh.data_quality !== row.data_quality)) {
      notes.push(`  ~ ${tag} · meta changed mid-walk (indexable ${row.indexable} -> ${fresh.indexable}, `
        + `data_quality ${row.data_quality} -> ${fresh.data_quality}) — re-checked against the fresh row`);
      row = { ...row, data_quality: fresh.data_quality, indexable: fresh.indexable };
      reRead = true;
    }
  }

  if (row.data_quality !== 'pass') {
    // coverage_coming: honest coverage page, never indexed (flag must be false too).
    if (st.isPass) fails.push(`${tag}: meta says coverage_coming but the page rendered a PASS state`);
    else if (row.indexable) fails.push(`${tag}: coverage_coming row has indexable=true (materializer bug)`);
    else if (indexable(st.robots)) fails.push(`${tag}: coverage-coming page is INDEXABLE (robots="${st.robots}")`);
    else notes.push(`  ✓ ${tag} · coverage-coming · noindex`);
  } else if (!st.isPass) {
    fails.push(`${tag}: expected a PASS page (real records) but got ${st.isCoverage ? 'coverage-coming' : st.isNotCovered ? 'not-covered' : 'an unrecognized state'}`);
  } else if (row.indexable && !indexable(st.robots)) {
    fails.push(`${tag}: substance-flagged page is NOT indexable (robots="${st.robots}")`);
  } else if (!row.indexable && indexable(st.robots)) {
    fails.push(`${tag}: pass-but-thin page is INDEXABLE (robots="${st.robots}") — must stay noindex`);
  } else if (!st.h1.includes(row.zip)) {
    fails.push(`${tag}: rendered H1 "${st.h1}" does not contain the ZIP`);
  } else {
    const bad = (st.recordLinks || []).filter((h) => !/^https?:\/\//i.test(h));
    if (bad.length) fails.push(`${tag}: ${bad.length} "public record" link(s) without a real http URL (anti-fabrication)`);
    else notes.push(`  ✓ ${tag} · pass · ${row.indexable ? 'indexable' : 'thin/noindex'} · ${(st.recordLinks || []).length} record link(s)`);
  }

  return { fails, notes, reRead, row };
}
