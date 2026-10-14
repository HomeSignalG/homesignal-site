# Search Console verification for the Jody host (slot)

Empty on purpose. Google gives the founder a file named `google<16 hex>.html` whose whole content is
`google-site-verification: <that file name>`. Commit it here and the Jody **launch** build (never staging, never the HomeSignal
build) ships it at the site root. `scripts/brand_stage.py` refuses any other file name, and refuses a file whose content is not
exactly that line, because a file that does not verify is a failed verification discovered after GO LIVE.

The alternative needs no file: add the DNS TXT record Google shows for a **Domain property** at Infomaniak. That verifies
`jodytracks.com`, `www`, http and https at once, and is what Change of Address works best with.

The old `google59e1ae3ef6b75e3a.html` proves ownership of homesignal.net only; the Jody build removes it. The redirect service
keeps answering it on the old host so that property stays verified.
