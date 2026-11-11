"""Static, crawlable summary for a /map/<zip>/ document (indexing pilot, 2026-11-11).

Why: every /map/<zip>/ document carried its whole page inside an inert <template>, so its first
HTML held six visible words, and scripts/page_semantics.py (which ignores <template>) never saw a
map's records change, so its sitemap lastmod and IndexNow never moved after 2026-10-27. This module
writes a small section OUTSIDE the template from data the build already loads for that ZIP: the
Rule D plane count and the ZIP's project pages. It states only what that data says. Nothing is
fetched, inferred or estimated.

Who gets it is decided by ONE manifest, data/seo-map-pilot.json:
  mode "pilot"  only the manifest's treatment ZIPs (the shipped state)
  mode "all"    every ZIP with a standard (Census-drawn) area (future rollout; not enabled)
  mode "off"    nobody (rollback without a code change)
A missing or unreadable manifest is "off": an unexpected state never widens the change.

Selection: docs/seo/map-indexing-pilot/ (SQL, verbatim output, fingerprint).
Test: test/map-zip-summary.test.mjs.
"""
import html
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
PILOT_PATH = os.path.join(HERE, "..", "data", "seo-map-pilot.json")
SECTION_ID = "hs-map-zip-summary"
ROW_CAP = 10
MODES = ("off", "pilot", "all")
ZIP_RE = re.compile(r"^\d{5}$")
DAY_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def esc(s):
    return html.escape(str(s if s is not None else ""), quote=True)


def load_pilot(path=PILOT_PATH):
    """{"mode": .., "treatment": set, "control": set}. Fails CLOSED to mode off."""
    try:
        d = json.load(open(path, encoding="utf-8"))
    except (OSError, ValueError):
        return {"mode": "off", "treatment": set(), "control": set(), "error": f"unreadable {path}"}
    mode = d.get("mode")
    tr = {z for z in (d.get("treatment") or []) if ZIP_RE.match(str(z))}
    ct = {z for z in (d.get("control") or []) if ZIP_RE.match(str(z))}
    if mode not in MODES or len(tr) != len(d.get("treatment") or []) or len(ct) != len(d.get("control") or []):
        return {"mode": "off", "treatment": set(), "control": set(), "error": "malformed manifest"}
    if tr & ct:
        return {"mode": "off", "treatment": set(), "control": set(), "error": "a ZIP is in both arms"}
    return {"mode": mode, "treatment": tr, "control": ct}


def treated(z, page, pilot):
    """Whether ZIP z gets the summary. A ZIP with no Census-drawn area (page["coverage"]) shows the
    coverage panel instead and never gets it, in any mode."""
    if page.get("coverage"):
        return False
    m = pilot.get("mode")
    if m == "all":
        return True
    if m == "pilot":
        return z in pilot.get("treatment", set())
    return False


def _rows(page, projects):
    """The ZIP's project pages, tracked first, newest date, key: the order the project pages'
    own 'More projects' list uses (gen_zip_pages.related_projects)."""
    out = [projects[k] for k in (page.get("project_list") or []) if k in projects]
    out.sort(key=lambda o: o["key"])
    out.sort(key=lambda o: o.get("date") or "", reverse=True)
    out.sort(key=lambda o: 0 if o.get("tracked", True) else 1)
    return out


def _row_html(pr):
    inner = f'<a href="{esc(pr["path"])}">{esc(pr["title"])}</a>'
    if pr.get("address"):
        inner += f' <span class="addr">{esc(pr["address"])}</span>'
    bits = [x for x in (pr.get("type"), pr.get("lifecycle")) if x]
    if bits:
        inner += f' <span class="quiet">{esc(" · ".join(bits))}</span>'
    if pr.get("date") and DAY_RE.match(pr["date"]):
        kind = f' ({esc(pr["date_kind"])})' if pr.get("date_kind") else ""
        inner += f' <span class="quiet">Date on record: <time datetime="{esc(pr["date"])}">{esc(pr["date"])}</time>{kind}</span>'
    if not pr.get("tracked", True):
        inner += ' <span class="quiet">(no longer tracked)</span>'
    if pr.get("url"):
        inner += f' <a href="{esc(pr["url"])}" rel="nofollow noopener">official record</a>'
    return f"<li>{inner}</li>"


def _entity_html(it):
    """A Rule D card with no project page: its name links to the official record, as on the
    community page (gen_zip_pages._card_title)."""
    inner = f'<a href="{esc(it["url"])}" rel="nofollow noopener">{esc(it["title"])}</a>'
    bits = [x for x in (it.get("type"), it.get("lifecycle")) if x]
    if bits:
        inner += f' <span class="quiet">{esc(" · ".join(bits))}</span>'
    if it.get("date") and DAY_RE.match(it["date"]):
        inner += f' <span class="quiet">Date on record: <time datetime="{esc(it["date"])}">{esc(it["date"])}</time></span>'
    return f"<li>{inner}</li>"


def count_sentence(page, z):
    """The plane's count, in its own scope. 'held' is a ZIP the plane did not measure; 'absent'
    is a measured ZIP below the Rule D bar (the plane omits those, so their exact count is not
    known here and none is stated)."""
    st = page.get("dev_plane_state")
    n = page.get("rule_d_count")
    if st == "counted" and isinstance(n, int) and n > 0:
        return (f"HomeSignal counts {n} distinct development project{'s' if n != 1 else ''} on record for ZIP {z}, "
                "compiled from official public sources. This is the same count the ZIP's community page uses.")
    if st == "counted":
        return (f"HomeSignal has no qualifying development projects on record for ZIP {z} from the official sources "
                "it reads. That describes HomeSignal's records, not whether development is happening here.")
    if st == "held":
        return (f"HomeSignal's development records for ZIP {z} were not measured in this update, so no count is shown.")
    return (f"Fewer than three development projects from the official sources HomeSignal reads qualify for ZIP {z}'s "
            "count. That describes HomeSignal's records, not whether development is happening here.")


def render(page, projects):
    """The section's HTML. Pure: same inputs, same bytes."""
    z = page["zip"]
    name = page.get("place_label") or page.get("name") or f"ZIP {z}"
    rows = _rows(page, projects)
    shown = rows[:ROW_CAP]
    parts = [f'<section class="hs-map-zip-summary" id="{SECTION_ID}" '
             f'aria-labelledby="{SECTION_ID}-h" data-zip="{esc(z)}">',
             f'<h2 id="{SECTION_ID}-h">Development records for ZIP {esc(z)} · {esc(name)}</h2>',
             f"<p>{esc(count_sentence(page, z))} The interactive map reads the official records live and also "
             "shows regulated facilities and other record types, so its totals can differ.</p>"]
    if shown:
        parts.append(f"<h3>Project pages for ZIP {esc(z)}</h3>")
        parts.append("<ul>" + "".join(_row_html(pr) for pr in shown) + "</ul>")
        if len(rows) > len(shown):
            parts.append(f"<p>Showing the newest {len(shown)} of {len(rows)} project pages for this ZIP.</p>")
    else:
        ents = [it for it in (page.get("dev_entities") or []) if it.get("title") and it.get("url")]
        if ents:
            parts.append(f"<h3>Development records for ZIP {esc(z)}</h3>")
            parts.append("<ul>" + "".join(_entity_html(it) for it in ents[:ROW_CAP]) + "</ul>")
        else:
            parts.append(f"<p>HomeSignal has no development project pages for ZIP {esc(z)} yet.</p>")
    links = [f'<a href="/community/{esc(z)}/">Government notices, meetings and local news for ZIP {esc(z)}</a>']
    if rows:
        links.append(f'<a href="/community/{esc(z)}/projects/">All {len(rows)} development project page'
                     f'{"s" if len(rows) != 1 else ""} for ZIP {esc(z)}</a>')
    parts.append("<p>" + " · ".join(links) + "</p>")
    parts.append("</section>\n")
    return "\n".join(parts)


def build_manifest(selection_path, mode="pilot"):
    """The manifest from the selection query's verbatim output (never retyped). Its fingerprint is
    md5 of sorted 'zip:arm' joined by ',' (collation-free; equal to the SQL's collate "C" form)."""
    import hashlib
    rows = json.load(open(selection_path, encoding="utf-8"))
    fp = hashlib.md5(",".join(sorted(f"{r['zip']}:{r['arm']}" for r in rows)).encode()).hexdigest()
    return {
        "mode": mode,
        "note": ("Development Map indexing pilot (2026-11-11). treatment: /map/<zip>/ carries the static summary "
                 "and its project list links to the map. control: unchanged documents, for comparison. Do not "
                 "request indexing for either arm. mode: off | pilot | all (all is the future rollout)."),
        "selection": {"sql": "docs/seo/map-indexing-pilot/selection.sql",
                      "output": "docs/seo/map-indexing-pilot/selection-output-2026-11-11.json",
                      "fingerprint_md5": fp, "rows": len(rows)},
        "treatment": sorted(r["zip"] for r in rows if r["arm"] == "treatment"),
        "control": sorted(r["zip"] for r in rows if r["arm"] == "control"),
        "strata": [{"zip": r["zip"], "arm": r["arm"], "state": r["state"], "group": r["grp"],
                    "map_members_2026_11_11": r["n"]} for r in rows],
    }


if __name__ == "__main__":
    import sys
    if len(sys.argv) == 3 and sys.argv[1] == "manifest":
        sys.stdout.write(json.dumps(build_manifest(sys.argv[2]), indent=1) + "\n")
    else:
        sys.exit("usage: map_zip_summary.py manifest <selection-output.json>")
