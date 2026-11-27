-- db-sql transaction probe (docs/db-sql-transaction-probe.md explains how to read it).
-- No persistent application-data changes: one transaction-local setting and one
-- temporary table that is dropped at commit. No BEGIN/COMMIT here ON PURPOSE: the point is
-- to see whether the submission route supplies the implicit transaction that the v2
-- city-community SQL relies on (SET LOCAL and an ON COMMIT DROP temp table).

-- 1. A transaction-local, namespaced setting.
set local homesignal.tx_probe = 'hs-tx-probe-20261121';

-- 2. A uniquely named temporary table that must survive until the end of the string.
create temp table hs_tx_probe_20261121 (
  setting_seen text,
  txid         bigint,
  backend_pid  integer
) on commit drop;

-- 3. Written by a LATER statement: reads the setting made in statement 1.
insert into hs_tx_probe_20261121
select current_setting('homesignal.tx_probe', true), txid_current(), pg_backend_pid();

-- 4. The one result the route returns: an explicit receipt.
select
  case
    when t.setting_seen = 'hs-tx-probe-20261121'
     and t.txid = txid_current()
     and t.backend_pid = pg_backend_pid()
    then 'TX_PROBE_OK'
    else 'TX_PROBE_MISMATCH'
  end                                             as receipt,
  t.setting_seen                                  as setting_seen_by_stmt3,
  (t.txid = txid_current())                       as same_transaction,
  (t.backend_pid = pg_backend_pid())              as same_session,
  current_setting('homesignal.tx_probe', true)    as setting_seen_by_stmt4,
  (select count(*) from hs_tx_probe_20261121)     as temp_rows
from hs_tx_probe_20261121 t;
