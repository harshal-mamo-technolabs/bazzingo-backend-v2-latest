const { renderProfileMarkup } = require("./profileSidebarView");

const renderHelpScoutProfileSidebarPage = (apiToken) => {
    const tokenJson = JSON.stringify(apiToken);
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Klaviyo profile</title><style>
:root{color-scheme:light;--ink:#19253a;--muted:#59677a;--line:#dfe5ed;--red:#b42332;--navy:#19253a}
*{box-sizing:border-box}html{height:auto}body{margin:0;padding:12px;font:14px/1.5 system-ui,sans-serif;color:var(--ink);background:#fff;overflow-wrap:anywhere}
header{padding:0 0 12px;border-bottom:1px solid var(--line);margin-bottom:14px}h1{font-size:18px;line-height:1.3;margin:3px 0 0;letter-spacing:-.3px}header small{font-size:10px;letter-spacing:1.4px;color:#285a9a;font-weight:700}
small,.muted{color:var(--muted)}small{font-size:12px}h2{font-size:11px;letter-spacing:1px;text-transform:uppercase;color:var(--muted);margin:0 0 12px}p{margin:8px 0}section{border:1px solid var(--line);border-radius:10px;padding:14px;margin:12px 0;box-shadow:0 2px 4px #19253a04}.plan-heading{display:flex;align-items:center;justify-content:space-between;gap:8px}.plan-heading strong{font-size:17px;line-height:1.3}.badge{display:inline-block;flex-shrink:0;background:#eaf5ee;color:#236442;padding:3px 8px;border-radius:20px;font-size:11px;font-weight:600}.badge.ending{background:#fff3df;color:#805719}.period{font-size:12px;color:var(--muted);margin:7px 0 12px}
button,select,textarea{font:inherit;width:100%;border:1px solid #cdd5e0;border-radius:6px;padding:10px;background:#fff;color:var(--ink);min-width:0}button{min-height:42px;cursor:pointer;font-weight:600;margin-top:10px}button.danger{color:white;background:var(--red);border-color:var(--red)}button:hover{background:#f3f5f8}button.danger:hover{background:#951d2a}button:disabled{cursor:wait;opacity:.6}button:focus-visible,select:focus-visible,textarea:focus-visible,input:focus-visible,summary:focus-visible{outline:3px solid #2563eb;outline-offset:2px}
label{display:block;font-size:13px;font-weight:500;margin:14px 0 6px}fieldset{border:0;border-top:1px solid var(--line);padding:14px 0 0;margin:16px 0}legend{font-size:13px;font-weight:600;padding:0 0 4px}input[type=checkbox]{flex:0 0 16px;width:16px;height:16px;margin:3px 9px 0 0;accent-color:var(--navy)}.check{display:flex;align-items:flex-start;min-height:38px;padding:8px 0;margin:0;font-size:13px;font-weight:400}.confirm{background:#f6f8fb;border-radius:6px;padding:10px;margin-top:14px}.notice,.error{border-radius:6px;padding:10px 12px;font-size:13px}.notice{background:#edf7f1;color:#236442}.error{background:#fff1f2;color:var(--red)}
details{border-top:1px solid var(--line);margin-top:12px}summary{cursor:pointer;min-height:44px;display:flex;align-items:center;justify-content:space-between;gap:8px;color:var(--red);font-size:13px;font-weight:600;list-style:none}summary::-webkit-details-marker{display:none}summary::after{content:'+';font-size:20px;font-weight:400}details[open]>summary::after{content:'−'}details[open]>summary{margin-bottom:6px}textarea{resize:vertical;min-height:80px}form{margin:0}.customer{font-size:12px;color:var(--muted);margin:0 0 12px}.footnote{font-size:12px;color:var(--muted);margin:14px 0 0}[hidden]{display:none!important}
.profile-identity{padding:0 0 14px}.profile-identity strong{display:block;font-size:18px;margin-bottom:3px}.profile-identity p{font-size:13px;color:var(--muted);margin:0}.profile-group{border:1px solid var(--line);border-radius:9px;margin:10px 0;padding:0 12px}.profile-group>summary{color:var(--ink);font-size:13px}.profile-group>summary span{font-size:11px;color:var(--muted);margin-left:auto}.profile-fields{margin:0 0 8px}.profile-row{border-top:1px solid #edf0f4;padding:9px 0}.profile-row dt{font-size:12px;color:var(--muted);margin-bottom:3px}.profile-row dd{margin:0;font-size:14px;white-space:pre-wrap;overflow-wrap:anywhere}.profile-row .badge{background:#eef2f6;color:var(--ink)}.profile-url{margin:0;border:0}.profile-url>summary{font-size:12px;color:#285a9a;min-height:32px}.profile-url code{display:block;font-size:11px;white-space:pre-wrap;overflow-wrap:anywhere;background:#f5f7fa;padding:8px;border-radius:5px}.profile-note{font-size:12px;color:var(--muted)}
.profile-group.usage .profile-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:4px 0 12px}.usage .profile-row{border:0;background:#f6f8fb;border-radius:6px;padding:9px}.usage .profile-row dd{font-size:19px;font-weight:600}.usage .profile-row dt{line-height:1.4}

</style></head><body><header><small>BAZZINGO</small><h1>Customer profile</h1></header><div id="status" role="status" class="muted">Loading the customer from Help Scout…</div><main id="root"></main><button id="refresh" type="button" hidden>Refresh profile</button>
<script type="module">
const API_TOKEN = ${tokenJson};
const renderProfileMarkup = ${renderProfileMarkup.toString()};
const statusEl = document.getElementById('status');
const rootEl = document.getElementById('root');
const refresh = document.getElementById('refresh');
let latestContext;
let currentKey = '';
let revision = 0;
let request;

function message(text, error = false) {
    statusEl.textContent = text;
    statusEl.className = error ? 'error' : 'muted';
    statusEl.setAttribute('role', error ? 'alert' : 'status');
}
async function load(context, force = false) {
    latestContext = context;
    const email = context?.customer?.emails?.[0]?.value || context?.customer?.email || '';
    const key = String(context?.conversation?.id || context?.customer?.id || '') + ':' + email;
    if (!force && email && key === currentKey) return;
    currentKey = key;
    request?.abort();
    request = new AbortController();
    const ownRevision = ++revision;
    rootEl.replaceChildren();
    refresh.hidden = !email;
    refresh.disabled = true;
    if (!email) {
        message('No customer email on this conversation yet.');
        return;
    }
    message('Loading Klaviyo profile…');
    try {
        const url = new URL('/helpscout/klaviyo-profile', window.location.origin);
        url.searchParams.set('email', email);
        const response = await fetch(url, { headers: { Authorization: 'Bearer ' + API_TOKEN }, signal: request.signal, credentials: 'omit' });
        const body = await response.json();
        if (ownRevision !== revision) return;
        if (!response.ok) throw new Error('Could not load the Klaviyo profile. Refresh to retry.');
        message('');
        rootEl.innerHTML = renderProfileMarkup(body.data?.profile || null, email);
    } catch (error) {
        if (ownRevision !== revision) return;
        currentKey = '';
        message('Could not load the Klaviyo profile. Refresh to retry.', true);
    } finally {
        if (ownRevision === revision) refresh.disabled = false;
    }
}
refresh.addEventListener('click', () => { if (latestContext) void load(latestContext, true); });
try {
    const { default: HelpScout } = await import('https://esm.sh/@helpscout/javascript-sdk@0.10.0');
    let lastHeight = 0;
    const resize = new ResizeObserver(() => {
        const height = Math.ceil(document.body.getBoundingClientRect().height);
        if (height !== lastHeight) { lastHeight = height; HelpScout.setAppHeight(height); }
    });
    resize.observe(document.body);
    window.addEventListener('pagehide', () => resize.disconnect(), { once: true });
    HelpScout.watchApplicationContext(context => { void load(context); });
    const context = await HelpScout.getApplicationContext();
    if (!latestContext) await load(context);
} catch {
    message('Could not read the Help Scout customer. Reload this sidebar.', true);
}
</script></body></html>`;
};
module.exports = { renderHelpScoutProfileSidebarPage };
