#!/usr/bin/env python3
"""Prohibited mutations of Order H's first step (2026-10-01): the legacy browser-direct report generator is retired from the
customer artifact, and no shipped page may generate a report outside the canonical gated path.

Each MUST make at least one of

    test/single-customer-generation-path.test.mjs
    test/nyc-v1-report.test.mjs        (pin 5f, flipped by Order H; 5e/5g/5h unchanged)

exit non-zero, AND the failing output must name the pin the mutation was written to hit (a mutation killed only by an
unrelated pin proves nothing about the pin it targets). Mutations M1..M7 are the seven the audit prescribed; the rest close
gaps in the same pins (a renamed engine copy that names the legacy page nowhere, a new lib that loads the engine, each of
the three server slugs, the robots line, a dead link to the retired page, a neutered detector).

    python3 test/single_customer_generation_path_mutants.py                 # every mutation
    python3 test/single_customer_generation_path_mutants.py name [name ...]

It edits files in place (creating or deleting some), runs the suites, and ALWAYS restores the originals, even on error or ^C. An
anchor that does not match exactly once is a harness failure, never a pass: a mutation that did not apply cannot be told from
one the suite survived. Run it from a copy of the tree if other work is open in this one. Exit 1 if any mutation survives,
2 on a harness fault. (Manual, like follow_report_mutants.py: CI runs the node tests, not this loop.)
"""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STAGE = 'scripts/stage_site.py'
NEW = 'test/single-customer-generation-path.test.mjs'
OLD = 'test/nyc-v1-report.test.mjs'
TESTS = [NEW, OLD]
LEGACY = 'future-surroundings-report.html'
ROOT_FILES_ANCHOR = "    # Decision and receipt: docs/order-h-retire-legacy-generator-2026-10-01.md.\n    'share-text.html',"

M = {}


def m(name, expect, edits=(), create=None, delete=()):
    """edits: [(file, old, new)] each anchored exactly once. create: {file: text-or-callable}. delete: [file]."""
    M[name] = dict(expect=expect, edits=list(edits), create=create or {}, delete=list(delete))


def legacy_copy():
    # A renamed copy of the legacy page that names the legacy page NOWHERE, so only a check on CONTENT can catch it.
    return (ROOT / LEGACY).read_text().replace('future-surroundings-report', 'renamed-copy')


def stage_adds(extra):
    return (STAGE, ROOT_FILES_ANCHOR, ROOT_FILES_ANCHOR.replace("    'share-text.html',", "    '%s',\n    'share-text.html'," % extra))


# ---- M1..M7: the audit's seven ---------------------------------------------------------------------------------------------------------
m('M1_page_readded_to_ROOT_FILES', ['P2a', '5f', 'P3'], [stage_adds(LEGACY)])
m('M2_city_host_added_to_a_shipped_pages_csp', ['P3'],
  [('development-activity.html', "connect-src 'self' https://qwnnmljucajnexpxdgxr.supabase.co wss://", "connect-src 'self' https://data.cityofnewyork.us https://qwnnmljucajnexpxdgxr.supabase.co wss://")])
m('M3_engine_script_tag_added_to_a_shipped_page', ['P3'],
  [('about.html', '</body>', '<script src="lib/nyc-v1-soda.js"></script></body>')])
m('M4_activity_function_invoked_by_a_shipped_page', ['P4'],
  [('about.html', '</body>', "<script>window.hsClient.functions.invoke('get-development-activity-report');</script></body>")])
m('M5_renamed_copy_of_the_legacy_page_is_staged', ['P3'],
  [stage_adds('fsr-renamed-copy.html')], create={'fsr-renamed-copy.html': legacy_copy})
m('M6_legacy_page_file_deleted', ['P2b'], delete=[LEGACY])
m('M7_scanner_pointed_at_an_empty_directory', ['P1a'],
  [(NEW, "const SRC = REPO;",
    "const SRC = mkdtempSync(path.join(tmpdir(), 'order-h-empty-')); process.on('exit', () => rmSync(SRC, { recursive: true, force: true }));")])
# ---- closing gaps in the same pins -------------------------------------------------------------------------------------------------------
m('M8_follow_function_invoked_by_a_shipped_page', ['P4'],
  [('about.html', '</body>', "<script>fetch('/functions/v1/follow-development-report');</script></body>")])
m('M9_legacy_function_invoked_by_a_shipped_script', ['P4'],
  [('contact.html', '</body>', "<script>window.hsClient.functions.invoke('get-future-surroundings-report');</script></body>")])
m('M10_new_lib_loads_the_engine_global', ['P3'], create={'lib/zz-order-h-mutant.js': "window.HSNycV1Soda.loadReport('1 Centre Street', '10007', 0.5);\n"})
m('M11_robots_disallow_for_the_retired_url_dropped', ['P2d', '5e'],
  [('robots.txt', 'Disallow: /future-surroundings-report.html\n', '')])
m('M12_a_shipped_page_links_to_the_retired_page', ['P2e'],
  [('about.html', '</body>', '<a href="future-surroundings-report.html">report</a></body>')])
m('M13_legacy_library_deleted', ['P2c'], delete=['lib/nyc-v1-soda.js'])
m('M14_city_host_detector_neutered', ['P3d', 'P3e'],
  [(NEW, "['the City of New York open-data host', /data\\.cityofnewyork\\.us/i]", "['the City of New York open-data host', /data\\.cityofnewyork\\.zz/i]")])
m('M15_slug_detector_neutered', ['P4d'], [(NEW, "const slugRe = (s) => new RegExp(s);", "const slugRe = (s) => new RegExp(s + 'zz');")])
m('M16_artifact_floor_removed', ['P1b'], [(NEW, "ok(pages.length >= 20,", "ok(pages.length >= 0 && false,")])


def run_tests():
    """Run both suites. Returns (any_failed, combined output, names of tests that exited non-zero)."""
    bad, out = [], ''
    for t in TESTS:
        r = subprocess.run(['node', t], cwd=ROOT, capture_output=True, text=True)
        out += r.stdout + r.stderr
        if r.returncode != 0:
            bad.append(t.split('/')[-1])
    return bad, out


def failed_checks(output):
    return [ln[len('FAIL — '):] for ln in output.splitlines() if ln.startswith('FAIL — ')]


def apply(spec):
    """Apply a mutation; return the originals to restore (path -> bytes, or None if the file did not exist)."""
    saved = {}

    def keep(rel):
        p = ROOT / rel
        if rel not in saved:
            saved[rel] = p.read_bytes() if p.exists() else None
        return p

    try:
        for rel, old, new in spec['edits']:
            p = keep(rel)
            text = p.read_text()
            if text.count(old) != 1:
                raise RuntimeError('anchor must match exactly once in %s, matched %d: %r' % (rel, text.count(old), old[:80]))
            p.write_text(text.replace(old, new))
        for rel, body in spec['create'].items():
            p = keep(rel)
            if saved[rel] is not None:
                raise RuntimeError('refusing to overwrite an existing file: ' + rel)
            p.write_text(body() if callable(body) else body)
        for rel in spec['delete']:
            p = keep(rel)
            if saved[rel] is None:
                raise RuntimeError('cannot delete a file that does not exist: ' + rel)
            p.unlink()
    except Exception:
        restore(saved)
        raise
    return saved


def restore(saved):
    for rel, data in saved.items():
        p = ROOT / rel
        if data is None:
            if p.exists():
                p.unlink()
        else:
            p.write_bytes(data)


def main():
    only = [a for a in sys.argv[1:] if not a.startswith('--')]
    unknown = set(only) - set(M)
    if unknown:
        print('HARNESS — unknown mutation(s): ' + ', '.join(sorted(unknown)))
        return 2
    bad, _ = run_tests()
    if bad:
        print('HARNESS — the unmutated tree does not pass: ' + ', '.join(bad))
        return 2
    survived, harness = [], []
    names = [k for k in M if not only or k in only]
    for name in names:
        spec = M[name]
        saved = None
        try:
            try:
                saved = apply(spec)
            except RuntimeError as e:
                print('HARNESS  %-52s %s' % (name, e))
                harness.append(name)
                continue
            bad, out = run_tests()
            fails = failed_checks(out)
            if not bad:
                print('SURVIVED %s' % name)
                survived.append(name)
                continue
            tokens = {f.split()[0] for f in fails if f.split()}
            missing = [e for e in spec['expect'] if e not in tokens]
            if missing:
                print('HARNESS  %-52s killed, but NOT by the pin(s) it targets: missing %s; failing checks: %s' % (name, missing, [f[:40] for f in fails][:6]))
                harness.append(name)
            else:
                print('killed   %-52s by %s  [%s]' % (name, ', '.join(bad), ', '.join(spec['expect'])))
        finally:
            if saved is not None:
                restore(saved)
    bad, _ = run_tests()
    if bad:
        print('HARNESS — the tree does not pass after restoring: ' + ', '.join(bad))
        return 2
    killed = len(names) - len(survived) - len(harness)
    print('\n%d mutations run, %d killed by the pin they target, %d survived, %d harness faults' % (len(names), killed, len(survived), len(harness)))
    if survived:
        print('SURVIVORS: ' + ', '.join(survived))
    return 1 if (survived or harness) else 0


if __name__ == '__main__':
    sys.exit(main())
