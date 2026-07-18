// Shared helpers for sampling modeled-but-unmaterialized ZIPs in verify-communities.
// Kept separate so unit tests can import without pulling in Playwright.

export const COMMUNITIES_PAGE_SIZE = 1000;

// Keyset page for modeled ZIP communities. Mirrors app_community_meta pagination: PostgREST
// silently truncates oversized single-page reads, and offset paging is unreliable at scale.
export function communitiesZipPagePath(lastId, pageSize = COMMUNITIES_PAGE_SIZE) {
  let path = `communities?select=zip_codes,id&level=eq.zip&order=id.asc&limit=${pageSize}`;
  if (lastId) path += `&id=gt.${encodeURIComponent(lastId)}`;
  return path;
}

// Walk every modeled ZIP community row until we collect `max` ZIPs with no app_* meta row.
export async function sampleUnmaterializedZips(materializedZips, restFn, max = 4, pageSize = COMMUNITIES_PAGE_SIZE) {
  const nonUt = [];
  let lastId = '';
  for (;;) {
    const page = await restFn(communitiesZipPagePath(lastId, pageSize));
    if (!page.length) break;
    for (const row of page) {
      for (const z of (row.zip_codes || [])) {
        if (/^\d{5}$/.test(z) && !materializedZips.has(z) && !nonUt.includes(z)) {
          nonUt.push(z);
          break;
        }
      }
      if (nonUt.length >= max) break;
    }
    if (nonUt.length >= max) break;
    if (page.length < pageSize) break;
    lastId = page[page.length - 1].id;
  }
  return nonUt;
}
