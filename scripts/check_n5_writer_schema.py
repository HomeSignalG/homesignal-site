#!/usr/bin/env python3
"""check_n5_writer_schema.py - refuse a writer that omits a column production requires.

WHY THIS EXISTS. Three production writer/schema mismatches reached a runner before anything
caught them, each one discovered only by the database refusing the insert:

  geo.n5_shard.checksum                          (#1275, found by an adversarial fixture)
  preservation.app_project_identity.identity_hash  (found by the first real `open`)
  preservation.app_project_identity.content_hash   (same statement, same run)

and a fourth was then found by this check rather than by production:

  geo.n5_snapshot.sources / projects / pairs / checksum

They are not typos. They are one defect class: a writer's INSERT column list is a SECOND
copy of the schema, and nothing compared the two. A structural test per column does not
scale and, worse, only ever covers the columns someone already lost.

WHAT IT PROVES. For every `insert into <schema>.<table> (cols...)` in the declared writers,
every column that production requires - NOT NULL, no default, not generated - appears in
that writer's column list. It reads the live catalogue, so a column ADDED to production
fails CI the same day, which no in-repo fixture can do.

WHAT IT DOES NOT PROVE. That the VALUES are right. A column can be supplied and wrong.
This bounds one failure mode completely and says nothing about the others.

  --schema-json FILE   read the catalogue from a file instead of the database, so the gate
                       itself can be tested offline and mutation-tested without a secret.
"""
import argparse
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))

# The writers this gate governs. A file added here is covered; one that is not, is not -
# so the list is the contract's surface and is deliberately explicit.
WRITERS = ["n5_orchestrate.py", "n5_shard.py"]

# insert into <schema>.<table> ( <columns> ) followed by select|values. The column list is
# what makes this a WRITER SHAPE check rather than a name search: a table name mentioned in
# a comment, a docstring or a stored scope string has no column list and cannot match.
INSERT_RE = re.compile(
    r'insert\s+into\s+([a-z_][a-z_0-9]*\.[a-z_][a-z_0-9]*)\s*'
    r'(?:as\s+[a-z_][a-z_0-9]*\s*)?\(([^;()]*?)\)\s*(?:select|values)',
    re.IGNORECASE | re.DOTALL)


def writer_inserts():
    """(table, column-set, writer file) for every insert with an explicit column list."""
    out = []
    for name in WRITERS:
        path = os.path.join(HERE, name)
        if not os.path.exists(path):
            raise SystemExit(f"STOP: declared writer {name} is missing. Refusing to pass a "
                             f"gate over a file that is not there.")
        src = open(path).read()
        # Strip whole-line Python comments. A comment that quotes an insert is prose, and
        # counting it is the exact mistake this file's sibling test made three times.
        code = "\n".join(l for l in src.split("\n") if not l.strip().startswith("#"))
        for m in INSERT_RE.finditer(code):
            cols = {c.strip().lower() for c in m.group(2).replace("\n", " ").split(",")
                    if c.strip()}
            out.append((m.group(1).lower(), cols, name))
    return out


def live_required(tables):
    """{table: {required columns}} - NOT NULL, no default, not generated."""
    sys.path.insert(0, HERE)
    from n3_pilot import sql, lit  # noqa: E402
    if not tables:
        return {}
    names = ",".join(lit(t.split(".", 1)[1]) for t in tables)
    schemas = ",".join(lit(t.split(".", 1)[0]) for t in tables)
    rows = sql(
        f"""select table_schema||'.'||table_name tbl, column_name
              from information_schema.columns
             where table_schema in ({schemas}) and table_name in ({names})
               and is_nullable = 'NO' and column_default is null and is_generated = 'NEVER';""",
        "live required columns", read_only=True)
    req = {}
    for r in rows:
        req.setdefault(r["tbl"], set()).add(r["column_name"].lower())
    return req


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--schema-json", default=None)
    args = ap.parse_args()

    inserts = writer_inserts()
    if not inserts:
        # An empty result reads exactly like a clean pass. It is not one.
        raise SystemExit("STOP: found 0 insert statements across the declared writers. "
                         "A gate that inspects nothing must never report success.")
    tables = sorted({t for t, _, _ in inserts})

    if args.schema_json:
        req = {k: {c.lower() for c in v} for k, v in json.load(open(args.schema_json)).items()}
    else:
        req = live_required(tables)

    unknown = [t for t in tables if t not in req]
    fails, checked = [], 0
    print(f"{'TABLE':44} {'WRITER':20} {'VERDICT':8} MISSING")
    print("-" * 104)
    for tbl, cols, who in sorted(inserts):
        if tbl not in req:
            print(f"{tbl:44} {who:20} {'UNKNOWN':8} table not in catalogue")
            continue
        missing = sorted(req[tbl] - cols)
        checked += 1
        print(f"{tbl:44} {who:20} {'FAIL' if missing else 'PASS':8} "
              f"{', '.join(missing) if missing else '-'}")
        if missing:
            fails.append((tbl, who, missing))

    print(f"\ninserts inspected: {len(inserts)} | tables checked: {checked} | "
          f"tables in catalogue: {len(req)}")
    if unknown:
        # Fail closed: a writer aimed at a table the catalogue does not have is either a
        # typo or a migration that has not landed. Either way it is not a pass.
        print("\nBLOCKER: writer targets a table absent from the catalogue:")
        for t in unknown:
            print(f"  {t}")
    if fails:
        print("\nBLOCKER: a production writer omits a column production requires:")
        for tbl, who, missing in fails:
            print(f"  {tbl} <- {who}: {', '.join(missing)}")
    if fails or unknown:
        return 1
    print("\nPASS: every declared writer supplies every required column.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
