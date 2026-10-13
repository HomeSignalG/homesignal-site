// Jody Step 16 hardening: the watch e-mail's SENDER and REPLY handling follow the brand, and a reply never goes to a no-reply address nobody reads.
// Found by the independent audit: WATCH_FROM is derived from the brand (`Jody <noreply@jodytracks.com>`), the domain being verified at the mail provider
// says nothing about a person reading replies, and the sender had no Reply-To at all. Run: node test/step16-outbound-email.test.mjs
import { readFileSync } from 'node:fs';
import { render, CONTRACT_FILE, REPLY_TO_BY_IDENTITY } from '../scripts/gen-brand-origins.mjs';
import { sendEmail } from '../supabase/functions/_shared/email-send.ts';
import * as watch from '../supabase/functions/_shared/watch-email.ts';
import * as gen from '../supabase/functions/_shared/brand-origins.generated.ts';

let failures = 0;
const check = (n, ok, why) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${ok ? '' : ` - ${why}`}`); if (!ok) failures++; };
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const contract = JSON.parse(readFileSync(CONTRACT_FILE, 'utf8'));
const v2 = JSON.parse(JSON.stringify(contract));
v2.contract_version = 2; v2.current_identity = 'jody'; v2.future_identity = 'homesignal';
v2.identities.jody.state = 'active'; v2.identities.homesignal.state = 'inactive';

// 1. under the committed v1 contract nothing changes: no Reply-To, the same sender
check('1a v1: the generated reply-to is null (HomeSignal has never sent a Reply-To)', gen.PUBLIC_REPLY_TO === null && watch.WATCH_REPLY_TO === null, String(gen.PUBLIC_REPLY_TO));
check('1b v1: the sender is exactly what it has always been', watch.WATCH_FROM === 'HomeSignal <noreply@homesignal.net>', watch.WATCH_FROM);
const bodyOf = async (m) => { let sent; await sendEmail(async (_u, init) => { sent = JSON.parse(init.body); return new Response('{}', { status: 200 }); }, 'k', m, 'idem'); return sent; };
const base = { from: watch.WATCH_FROM, to: 'agent@example.com', subject: 's', text: 't', html: '<p>h</p>' };
const plain = await bodyOf(base);
check('1c a message with no reply_to is sent with EXACTLY the five fields it has always had', JSON.stringify(Object.keys(plain)) === JSON.stringify(['from', 'to', 'subject', 'text', 'html']), JSON.stringify(Object.keys(plain)));

// 2. under v2 the sender is Jody's and replies reach a mailbox a person reads
const r2 = render(v2);
check('2a v2: the generated reply-to is the Jody mailbox that exists', r2.includes("export const PUBLIC_REPLY_TO: string | null = 'contact@jodytracks.com';"), r2.split('\n').filter((l) => l.includes('PUBLIC_REPLY_TO')).join(' | '));
check('2b v2: the sender is Jody\'s own verified domain', r2.includes("PUBLIC_NAME = 'Jody'") && r2.includes("PUBLIC_HOST = 'jodytracks.com'"), 'sender');
const withReply = await bodyOf({ ...base, reply_to: 'contact@jodytracks.com' });
check('2c a message that carries reply_to sends it to the provider (Resend\'s field name)', withReply.reply_to === 'contact@jodytracks.com', JSON.stringify(withReply));
check('2d …and only then (the other five fields are unchanged)', JSON.stringify(Object.keys(withReply).filter((k) => k !== 'reply_to')) === JSON.stringify(Object.keys(plain)), 'fields');

// 3. the decision cannot be forgotten for an identity: a brand with no recorded decision cannot be rendered
check('3a every identity in the generator has a recorded reply-to decision', Object.keys(REPLY_TO_BY_IDENTITY).sort().join() === Object.keys(contract.identities).sort().join(), Object.keys(REPLY_TO_BY_IDENTITY).join());
check('3b the Jody reply-to is a Jody-domain address (never a HomeSignal mailbox after the move)', REPLY_TO_BY_IDENTITY.jody.endsWith('@jodytracks.com') && REPLY_TO_BY_IDENTITY.homesignal === null, JSON.stringify(REPLY_TO_BY_IDENTITY));

// 4. the sending function passes it (structural pin on the comment-stripped source, with a control that the pin can fail)
const handler = strip(readFileSync('supabase/functions/run-property-watch/handler.ts', 'utf8'));
const wired = /reply_to:\s*WATCH_REPLY_TO/.test(handler) && /WATCH_REPLY_TO\s*\?/.test(handler);
check('4a the watch sender includes reply_to from the brand-derived constant, only when there is one', wired, 'handler does not pass WATCH_REPLY_TO');
const unwired = handler.replace(/\.\.\.\(WATCH_REPLY_TO \? \{ reply_to: WATCH_REPLY_TO \} : \{\}\),\s*/, '');
check('4b control: with that line removed the pin fails (it is not vacuous)', unwired !== handler && !(/reply_to:\s*WATCH_REPLY_TO/.test(unwired)), 'pin insensitive');
const other = (readFileSync('supabase/functions/_shared/email-send.ts', 'utf8'));
check('4c the e-mail adapter forwards reply_to only when set', /\.\.\.\(m\.reply_to \? \{ reply_to: m\.reply_to \} : \{\}\)/.test(other), 'adapter');

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
