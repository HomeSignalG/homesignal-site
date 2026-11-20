// Share by Email: mailto must not open in a new tab (Brave shows a blank tab with no mail app), and Gmail/Outlook web
// compose links must be offered, carrying the same link. Runs the shipped lib/share-modal.js.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + m); if (!c) fails++; };
const win = { document: { addEventListener() {} } }; win.window = win;
vm.runInNewContext(readFileSync(new URL('../lib/share-modal.js', import.meta.url), 'utf8'), win);
const link = 'https://jodytracks.com/shared-report.html#t=abc';
const html = win.HS.shareGridHTML(link, 'A private report');
const anchors = [...html.matchAll(/<a class="sopt" href="([^"]*)"([^>]*)>[\s\S]*?<\/span>([^<]*)<\/a>/g)].map(m => ({ href: m[1].replace(/&amp;/g, '&'), attrs: m[2], name: m[3] }));
const by = n => anchors.find(a => a.name === n);
const enc = encodeURIComponent(link);
ok(by('Email') && by('Email').href.startsWith('mailto:?subject=') && by('Email').href.includes('body=' + enc), 'Email is a mailto carrying the private link');
ok(!/target=/.test(by('Email').attrs), 'Email does not open a new tab (blank-tab bug)');
ok(by('Gmail') && by('Gmail').href.startsWith('https://mail.google.com/mail/?view=cm') && by('Gmail').href.includes('body=' + enc) && /_blank/.test(by('Gmail').attrs), 'Gmail web compose carries the link');
ok(by('Outlook') && by('Outlook').href.startsWith('https://outlook.live.com/mail/0/deeplink/compose') && by('Outlook').href.includes('body=' + enc), 'Outlook web compose carries the link');
ok(/data-hs-copy/.test(html), 'Copy link stays offered');
ok(/No email app opened/.test(readFileSync(new URL('../lib/share-modal.js', import.meta.url), 'utf8')), 'the shared box offers the no-mail-app fallback');
process.exit(fails ? 1 : 0);
