// HomeSignal app runtime config — the ONE place URLs/keys live (never hardcode per page).
// Reuses the existing homesignal.net Supabase project + public anon key (same values the
// live community.html/index.html already ship). The anon key is public by design; RLS is the
// gate. Base/share URLs are derived from the runtime origin, never hardcoded.
window.HS_CONFIG = {
  SUPABASE_URL: 'https://qwnnmljucajnexpxdgxr.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF3bm5tbGp1Y2FqbmV4cHhkZ3hyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0MTAyOTgsImV4cCI6MjA5NTk4NjI5OH0.prpXB6lSIhWMAsdkkaxAfkvEodbojfUUyN4L4JbQE1U',

  // Data source: 'seed' runs the whole app with zero DB (the review/prototype path);
  // 'supabase' reads the live project. Overridable at runtime with ?data=seed|supabase.
  DATA_SOURCE: 'seed',

  // Local-dev only: pretend a demo user is signed in so authed screens render.
  // On the real site this is false and the existing Supabase session is used.
  // Overridable with ?demo=1 for preview.
  DEMO_SESSION: true,

  // The prototype community for Phase 1 (Del Valle, TX — Travis County).
  DEFAULT_ZIP: '78617',

  // Base URL for share links; derived from origin so it works in preview and prod.
  get BASE_URL() { return window.location.origin; }
};

// Runtime overrides via query string (?data=, ?demo=).
(function () {
  var q = new URLSearchParams(window.location.search);
  if (q.get('data'))  window.HS_CONFIG.DATA_SOURCE = q.get('data');
  if (q.get('demo'))  window.HS_CONFIG.DEMO_SESSION = q.get('demo') !== '0';
})();
