# Development dossier prototype (not production)

Local, non-production prototype for the Universal Project Pages plan. It is not built or deployed:
`docs/` is outside the Pages artifact. Design and decisions: `docs/development-dossier-design-2026-10-29.md`.

- `fixtures/*.json`: reviewed evidence for Stratos (data center, Box Elder County UT) and Proctor 4
  (mixed-use, Tacoma WA). Every item has a source link and an evidence grade. In production these come
  from approved `development_project_link` rows.
- `fixtures/stratos_anchor_parcels.csv`: byte copy of homesignal-ingest `data/stratos_anchor_parcels.csv`.
  It matches production `resolved_project_parcels` (83 rows; md5 over `apn:owner:acres:zip:anchor` sorted
  `collate "C"` = `0888f4b5f2ca987710271059eb410a51` on both sides, 2026-10-29).
- `render.py`: one generic renderer, with no project-specific code. Type and lifecycle come from
  `lib/project-type.js` through `type.mjs`.
- `out/*.html`: the rendered pages. Open them in a browser.

```bash
python3 docs/prototypes/development-dossier/render.py --check
```

`--check` renders both pages with every script removed and verifies:
- each fact, organization and source link is present;
- there is one H1 and one canonical link;
- all nine sections exist;
- the renderer names no project.
