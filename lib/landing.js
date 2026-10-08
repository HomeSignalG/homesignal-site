// HomeSignal landing decision — the ONE place mapping (session, home) -> where a visitor
// belongs. Pure (no DOM/globals): consumed by index.html and unit-tested directly
// (test/landing.test.mjs).
//
// index.html IS EXPLORE, FOR EVERYONE (founder navigation plan v3, 2026-09-30). Until then a
// real signed-in resident with a saved Address was bounced from index.html to dashboard.html
// (#281), which meant the logo could never show a resident Explore. That redirect is gone:
// every visitor stays on index.html, and the Dashboard ("What's Changed") is reached from
// My Places, which the homepage's "Go to My Places" link opens. Do NOT bring the bounce back
// behind a query flag or a second Explore route; the plan forbids both.
//
// The function is kept, rather than deleted, so the decision still has exactly one home if
// a later founder ruling sends some visitor somewhere else. A demo session must still never
// land on the dashboard (#280's signed-out sample path); that holds because nobody does.
(function () {
  // session: Supabase session object | { demo:true } stand-in | null
  // activeProperty: resident's saved home row | null
  // -> null for every visitor: stay on index.html (Explore).
  function landingFor(session, activeProperty) {
    return null;
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { landingFor };
  if (typeof window !== 'undefined') (window.HS = window.HS || {}).landingFor = landingFor;
})();
