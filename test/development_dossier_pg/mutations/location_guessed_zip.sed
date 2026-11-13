# A ZIP is named even when it has no page (the registry join dropped).
s/                 from geo.zcta_boundary b join public.canonical_zip_registry r on r.zip = b.zcta5/                 from geo.zcta_boundary b/
