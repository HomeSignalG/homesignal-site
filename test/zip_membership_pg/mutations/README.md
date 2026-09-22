Each file here is a deliberate regression. `run.sh` applies one, re-runs `../suite.sql`, and
FAILS THE JOB if the suite still passes: a suite that cannot tell these apart from the shipped
functions proves nothing. The third mutation is `docs/fix28-datacenter-zip-membership.sql`
itself — re-applying it restores the Data-center-ONLY trigger, i.e. Type-scoped membership.
