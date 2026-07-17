// HomeSignal landing decision — the ONE place mapping (session, home) -> where a visitor
// belongs. Pure (no DOM/globals): consumed by index.html and unit-tested directly
// (test/landing.test.mjs). The three flag names live HERE so a rename can't silently break
// the sample carve-out — a demo session must NEVER land on the dashboard, which would
// re-break the #280 signed-out sample path.
(function () {
  // session: Supabase session object | { demo:true } stand-in | null
  // activeProperty: resident's saved home row | null
  // -> 'dashboard.html' for a real signed-in resident WITH a home set; else null (stay on hero).
  function landingFor(session, activeProperty) {
    var signedInResident = !!(session && !session.demo);
    return (signedInResident && activeProperty) ? 'dashboard.html' : null;
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { landingFor };
  if (typeof window !== 'undefined') (window.HS = window.HS || {}).landingFor = landingFor;
})();
