#!/usr/bin/env python3
"""Bundle the multi-page /app into ONE self-contained HTML for a hosted preview.

Reuses the REAL app assets (app.css, partials/shell.html, config/seed/lib/shell.js,
and every page's <template> + init script) verbatim — only navigation becomes
client-side (no fetch, no separate files, no external CDN) so it runs as a single
file. Seed mode + demo session, so no DB/keys needed. Output: preview-delvalle.html
"""
import re
from pathlib import Path

APP = Path(__file__).parent
read = lambda p: (APP / p).read_text(encoding="utf-8")

PAGES = [  # (file, registry-key, active-nav)
    ("index.html", "home", ""), ("today.html", "today", "today"),
    ("dashboard.html", "dash", "dash"), ("alerts.html", "alerts", "alerts"),
    ("development.html", "dev", "dev"), ("maps.html", "maps", "maps"),
    ("properties.html", "props", "props"), ("property.html", "prop", "props"),
    ("community.html", "comm", "comm"), ("reports.html", "reports", "reports"),
    ("contact.html", "contact", ""), ("privacy.html", "privacy", ""),
]

def rewrite_nav(s: str) -> str:
    # client-side routing: location.href='x.html' and window.open(x,'_self') -> HS.nav setter
    s = re.sub(r"location\.href\s*=(?!=)", "HS.nav=", s)
    s = re.sub(r"window\.open\((.*?),\s*'_self'\)", r"HS.nav=(\1)", s)
    s = s.replace("new URLSearchParams(location.search)", "new URLSearchParams(HS.__search||'')")
    return s

def extract(page_file):
    html = read(page_file)
    tpl = re.search(r"<template id=\"hs-content\">(.*?)</template>", html, re.S).group(1)
    scripts = re.findall(r"<script>(.*?)</script>", html, re.S)  # attribute-less = page init
    init = "\n".join(scripts)
    return rewrite_nav(tpl), rewrite_nav(init)

# --- shared assets -----------------------------------------------------------
app_css   = read("app.css")
shell_html = read("partials/shell.html")
config_js  = read("config.js")
seed_js    = read("seed/delvalle.js")
data_js    = read("lib/data.js")
templates_js = read("lib/templates.js")
map_js     = read("lib/map.js")
shell_js   = read("shell.js")

# shell.js: inline the shell HTML instead of fetch(); apply nav rewrite
shell_js = shell_js.replace(
    "const html = await fetch('partials/shell.html').then(r => r.text());",
    "const html = window.__SHELL_HTML;")
shell_js = rewrite_nav(shell_js)

# --- page registry -----------------------------------------------------------
regs = []
for f, key, nav in PAGES:
    tpl, init = extract(f)
    if key == "home":
        init += "\nwindow.homeFind=homeFind;"      # template calls homeFind() by name
    if key == "contact":
        init += "\nwindow.sendContact=sendContact;"  # template calls sendContact()
    regs.append((key, nav, tpl, init))

def js_backtick(s: str) -> str:
    return s.replace("\\", "\\\\").replace("`", "\\`").replace("${", "\\${")

page_defs = ",\n".join(
    "  %r: { nav: %r, html: `%s`, init: function(){\n%s\n} }" % (key, nav, js_backtick(tpl), init)
    for key, nav, tpl, init in regs
)

ROUTER = """
// ---- single-file preview router (client-side; the real app uses separate pages) ----
window.__SHELL_HTML = SHELL_HTML_PLACEHOLDER;
HS.__search = '';
HS.pages = {
PAGE_DEFS
};
Object.defineProperty(HS, 'nav', { configurable:true, set:function(u){ HS.route(u); } });
HS.route = function(u){
  if(!u) return;
  if(/^(https?:|mailto:|data:|blob:)/i.test(u)){ window.open(u,'_blank','noopener'); return; }
  var parts = String(u).split('?'); var file = parts[0].split('/').pop();
  HS.__search = parts[1] ? ('?'+parts[1]) : '';
  var M = {'index.html':'home','':'home','today.html':'today','dashboard.html':'dash',
    'alerts.html':'alerts','development.html':'dev','maps.html':'maps','properties.html':'props',
    'property.html':'prop','community.html':'comm','reports.html':'reports',
    'contact.html':'contact','privacy.html':'privacy'};
  HS.showPage(M[file] || 'home');
};
HS.showPage = function(name){
  var p = HS.pages[name] || HS.pages.home;
  var slot = document.getElementById('hs-slot'); if(!slot) return;
  slot.innerHTML = p.html;
  document.querySelectorAll('.nav a').forEach(function(a){ a.classList.remove('on'); });
  if(p.nav){ var a = document.querySelector('.nav a[data-nav="'+p.nav+'"]'); if(a) a.classList.add('on'); }
  window.scrollTo(0,0);
  try { p.init(); } catch(e){ console.error('page init', name, e); }
};
document.addEventListener('click', function(e){
  var a = e.target.closest && e.target.closest('a[href]'); if(!a) return;
  var h = a.getAttribute('href');
  if(h && /\\.html(\\?|$)/.test(h)){ e.preventDefault(); HS.route(h); }
});
HS.onReady(function(){ HS.route('index.html'); });
"""
router = ROUTER.replace("SHELL_HTML_PLACEHOLDER", "`" + js_backtick(shell_html) + "`") \
               .replace("PAGE_DEFS", page_defs)

banner = ("<!-- HomeSignal Del Valle preview — GENERATED single-file bundle of /app. "
          "Seed mode, no DB. Source of truth is the multi-page app under /app. -->")
out = f"""{banner}
<title>HomeSignal — Del Valle (78617) preview</title>
<style>
{app_css}
</style>
<div id="hs-preview-note" class="hs-preview-ribbon">Preview · <b>Del Valle, TX 78617</b> · seed data · staged under /app (live site untouched)</div>
<script>
{config_js}
window.HS_CONFIG.DATA_SOURCE = 'seed'; window.HS_CONFIG.DEMO_SESSION = true;
</script>
<script>
{seed_js}
</script>
<script>
{data_js}
</script>
<script>
{templates_js}
</script>
<script>
{map_js}
</script>
<script>
{shell_js}
</script>
<script>
{router}
</script>
"""
Path(APP / "preview-delvalle.html").write_text(out, encoding="utf-8")
print("wrote", APP / "preview-delvalle.html", f"({len(out)} bytes)")
