# Atlas ↔ Epoch identity evidence — measured before any automatic rule was written (2026-09-24)

**Why this file exists.** On 2026-09-24 the founder ruled that identity must be **automatic**:
every recurring record ends as `AUTO_CONFIRMED_MATCH`, `AUTO_CONFIRMED_DISTINCT` or
`IDENTITY_UNRESOLVED`, and no person is ever in the ingest loop. That ruling also set the order of
work: *measure first, then design the rules*. The rules in `docs/dc-step3a-canonical-identity.sql`
(A4 and the exclusivity rule) are justified by the measurements below and by nothing else.

## Corpus

- **Epoch.** 92 current `epoch_ai/data_centers` records. 77 are US (`Country = 'United States'`)
  and 15 are not. The publisher states no lifecycle for any of them: `source_native_status` is
  NULL on 92 of 92.
- **Atlas.** 2,187 current `compute_atlas/facilities` records.
  - 876 state a `street`.
  - 777 of those streets start with a single house number, giving 755 distinct addresses.
- **Derived Epoch points.** Taken from the zero-write probe run through the production geocoding
  ladder: 35 accepted-shaped, 34 failed, 8 not attempted.

## Stable Epoch record identity (run churn)

| | value |
|---|---:|
| Epoch runs on record | 3 (87 / 92 / 91 records) |
| observations | 270 |
| distinct names across all runs | **92** |
| names repeated **inside** a run | **0** |
| live Epoch entities before this change | 270 (one per record per run) |

So the name is a run-unique, stable record key for this distribution. `dc_observation_record_key`
uses it only when it is unique within its run. A name repeated inside a run stays a singleton, and
a derived point never places a singleton record (`UNSTABLE_RECORD_IDENTITY`).

## Exact site address (house number + street + stated state)

| measure | count |
|---|---:|
| `EXACT_ADDRESS_CROSS_SOURCE_PAIRS` | **5** |
| `EXACT_ADDRESS_SAME_PHYSICAL_FACILITY` | **5** |
| `EXACT_ADDRESS_DISTINCT_FACILITIES` | **0** |
| `EXACT_ADDRESS_AMBIGUOUS` | **0** |

| Epoch record | Atlas record | note |
|---|---|---|
| AWS Berwick, 1125 Electron Ave, PA | AWS Cumulus Data Center Campus, Salem Township | one campus; mailing city vs township |
| CoreWeave Lancaster Greenfield site, 216 Greenfield Rd, PA | CoreWeave Lancaster Data Center | same |
| CoreWeave Muskogee OK, 1525 W 43rd St S | Core Scientific Muskogee Campus | **tenant vs operator** at one facility |
| Microsoft Project Osmium, 5855 SW Kerry St, IA | Microsoft Project Osmium Data Center | mailing city vs municipality |
| Stream Phoenix, 2950 S. Litchfield Road | Stream Data Centers PHXA (Goodyear) | same campus, but **Epoch states no state**, so no rule can verify it: stays unresolved |

**An address does not always single out a facility, which is why the rule requires uniqueness:**

- **2 Epoch addresses carry two different Epoch records:**
  - 7725 Lake Rd: Anthropic and Core42, two tenants of one campus;
  - 5502 Spinks Rd: "Crusoe Abilene Expansion" and "OpenAI Stargate Abilene", an expansion beside the original.
- **19 Atlas addresses carry more than one Atlas record** (campus buildings).

The automatic rule therefore requires, all at once:
- the address is unique among the current records of **each** source;
- both records are data centres;
- neither record is an aggregate multi-site record;
- the postal codes agree whenever both are stated;
- there is no conflicting sibling designation.

## Evidence measured and REJECTED as identity

| signal | counter-example from the corpus |
|---|---|
| distance (any radius) | Epoch "Colossus 2" at 5420 Tulane Rd is **3 m** from Atlas "Minihard" (5414 Tulane Rd), while Atlas "Colossus 2 (Whitehaven)" is at 5400 Tulane Rd; Epoch "Microsoft-Nebius New Jersey" is **6.8 km** from Atlas "Nebius Vineland Data Center" (the same facility) |
| numbered designation | "Vantage TX1" vs "Vantage San Antonio TX11", **89 m** apart (a campus and its first building); "QTS Richmond 1" vs "QTS Richmond 1 DC1 (RIC1…)"; "Dalton 1 & 2" vs "Dalton II" |
| different address ⇒ distinct | "Meta Temple" is 2310 Eberhardt Rd in Epoch and 3101 Industrial Blvd in Atlas: not provably different |
| same operator / owner | Google, Microsoft, Meta each operate several facilities in one city |
| same name tokens | "Meta-QTS Hillsboro 2" shares its designation with both "QTS Hillsboro 2" and "Flexential Portland – Hillsboro 2" |

A designation can therefore **only block** a match. It never confirms one, and it never proves
two records distinct.

## What is automatic, and what that leaves

- **`AUTO_CONFIRMED_MATCH`** comes from A4, the exact site address under the guards above.
  Nothing else.
- **`AUTO_CONFIRMED_DISTINCT`** comes from:
  - A2: the publisher itself separates its records;
  - **exclusivity**: a record matched to Atlas X is not Atlas Y, because Atlas separates X from Y;
  - the absence of any cross-source candidate within the recall net (10 km, or the same state and
    city).
- **`IDENTITY_UNRESOLVED`** covers everything else. It is a completed automatic decision. It holds
  a derived point (so there are never two markers for one site), and it is recomputed from the
  evidence on every scheduled run: a record that gains an exact address later merges on its own.

Data: the matrix was built from `public.dc_current_observation` on 2026-09-24,
from the zero-write probe run's derived points, and from the Atlas structured address fields.
