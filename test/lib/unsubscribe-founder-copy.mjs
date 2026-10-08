// The founder's text for homesignal.net/unsubscribe after a Map 1 sign-up is turned off
// (2026-09-26, "change the text to this"). Locked (CLAUDE.md Rule #0). Shared by the
// offline pins and the browser test so both check the same words.
export const FOUNDER_TITLE = "You're unsubscribed from Development alerts";

export const FOUNDER_LINES = (zip) => [
  "You'll no longer receive Development email alerts for ZIP code " + zip + '.',
  'This only changes the Development alerts you signed up for from the map. If you also ' +
    'receive Government Notices, Upcoming Meetings, or Local News emails, those subscriptions ' +
    'are separate and will continue as usual.',
  'You can sign up for Development alerts again anytime from the HomeSignal map.',
];

export const FOUNDER_CTA = (zip) => 'Return to the ' + zip + ' map';

// What every other answer shows, unchanged.
export const GENERAL_TITLE = "You're unsubscribed";
export const GENERAL_TEXT =
  'You will no longer receive HomeSignal digest emails. You can re-subscribe anytime at homesignal.net.';
