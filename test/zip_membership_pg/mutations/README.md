Each file here is a deliberate regression. `run.sh` applies one, re-runs `../suite.sql`, and
FAILS THE JOB if the suite still passes: a suite that cannot tell these apart from the shipped
functions proves nothing.

- `centroid_radius.sql` — membership becomes "within 5 miles of the ZIP centroid".
- `national_bypass.sql` — the national read stamps every retrieved candidate a member (a
  source-specific ZIP association).
- `national_type_scoped.sql` — the national read serves only one project Type, i.e. Type
  deciding geography.
- `facility_bypass.sql` — the facility read serves every cached facility point as a member
  (the radius-derived EPA plane restored).
