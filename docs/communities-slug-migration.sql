-- communities-slug-migration.sql
-- Adds a pure-data `slug` to public.communities so ?community=<slug> resolves
-- against the DB directly (community.html), removing the dependency on a
-- communities.js bootstrap entry. Additive and non-destructive.
--
-- Applied to project qwnnmljucajnexpxdgxr (migration name: communities_add_slug).
-- Parked here per CLAUDE.md §1 source #3: schema changes are reproducible SQL.

alter table public.communities add column if not exists slug text;

-- Backfill the two launch communities to match their existing communities.js slugs.
update public.communities set slug = 'box-elder'
  where id = 'd67c558f-1f04-4811-a565-873ae2afd6f3' and slug is null;
update public.communities set slug = 'eagle-mountain'
  where id = '3aa7541e-2aa1-4254-96d2-962240cd2e32' and slug is null;

-- Case-insensitive uniqueness; partial so multiple not-yet-slugged rows are allowed.
create unique index if not exists communities_slug_lower_key
  on public.communities (lower(slug)) where slug is not null;

-- Going forward: set `slug` when inserting a new community (kebab-case of the name),
-- e.g. insert ... (name, ..., slug) values ('Tremonton, Utah', ..., 'tremonton');
