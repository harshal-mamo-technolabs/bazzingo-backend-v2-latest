const renderHelpScoutProfileSidebarPage = (apiToken) => {
    const tokenJson = JSON.stringify(apiToken);

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Klaviyo profile</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin: 0; padding: 12px; font-size: 13px; color: #1a1a1a; background: #fafafa; }
    h1 { font-size: 14px; margin: 0 0 12px; font-weight: 600; }
    .muted { color: #666; }
    .err { color: #b00020; margin: 8px 0; }
    .card { background: #fff; border: 1px solid #e5e5e5; border-radius: 8px; padding: 12px; }
    dl { margin: 0; }
    dt { font-weight: 600; margin-top: 8px; color: #444; }
    dt:first-child { margin-top: 0; }
    dd { margin: 4px 0 0; word-break: break-word; }
    pre { margin: 0; white-space: pre-wrap; font-size: 12px; }
    .section-title { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: #888; margin: 14px 0 6px; font-weight: 600; }
    .section-title:first-child { margin-top: 0; }
    .subsection { margin-top: 12px; padding-top: 12px; border-top: 1px solid #eee; }
  </style>
</head>
<body>
  <h1>Klaviyo</h1>
  <div id="status" class="muted">Loading…</div>
  <div id="root"></div>
  <script type="module">
    const API_TOKEN = ${tokenJson};
    const statusEl = document.getElementById('status');
    const rootEl = document.getElementById('root');

    function setStatus(msg) {
      statusEl.textContent = msg;
    }

    function renderError(msg) {
      setStatus('');
      const d = document.createElement('div');
      d.className = 'err';
      d.textContent = msg;
      rootEl.replaceChildren(d);
    }

    function addRow(dl, label, value) {
      if (value === undefined || value === null || value === '') return;
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        const pre = document.createElement('pre');
        pre.textContent = JSON.stringify(value, null, 2);
        dd.appendChild(pre);
      } else {
        dd.textContent = String(value);
      }
      dl.appendChild(dt);
      dl.appendChild(dd);
    }

    function humanizeLabel(key) {
      if (!key || typeof key !== 'string') return String(key);
      var t = key.trim();
      if (!t) return key;
      return t.charAt(0).toUpperCase() + t.slice(1);
    }

    function formatPropertyValue(raw) {
      if (raw === null || raw === undefined) return '';
      if (typeof raw === 'boolean') return raw ? 'Yes' : 'No';
      if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw);
      if (typeof raw === 'object') {
        try {
          return JSON.stringify(raw, null, 2);
        } catch (e) {
          return String(raw);
        }
      }
      if (typeof raw === 'string') {
        var s = raw.trim();
        if (/^\\d{4}-\\d{2}-\\d{2}/.test(s)) {
          var d = new Date(s);
          if (!isNaN(d.getTime())) {
            var hasTime = /T\\d{2}:/.test(s);
            return hasTime
              ? d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
              : d.toLocaleDateString(undefined, { dateStyle: 'long' });
          }
        }
        return raw;
      }
      return String(raw);
    }

    function renderProfile(profile, email) {
      const card = document.createElement('div');
      card.className = 'card';
      const mainDl = document.createElement('dl');
      addRow(mainDl, 'Email', profile.email || email);
      addRow(mainDl, 'First name', profile.firstName);
      addRow(mainDl, 'Last name', profile.lastName);
      addRow(mainDl, 'Phone', profile.phoneNumber);
      addRow(mainDl, 'External ID', profile.externalId);
      addRow(mainDl, 'Klaviyo profile ID', profile.id);
      addRow(mainDl, 'Updated', formatPropertyValue(profile.updated) || profile.updated);
      card.appendChild(mainDl);

      var props = profile.properties;
      if (props && typeof props === 'object' && !Array.isArray(props)) {
        var keys = Object.keys(props).sort(function (a, b) {
          return a.toLowerCase().localeCompare(b.toLowerCase());
        });
        if (keys.length) {
          const sub = document.createElement('div');
          sub.className = 'subsection';
          const h2 = document.createElement('h2');
          h2.className = 'section-title';
          h2.textContent = 'Custom properties';
          sub.appendChild(h2);
          const propDl = document.createElement('dl');
          keys.forEach(function (key) {
            var raw = props[key];
            if (raw === undefined) return;
            var display = formatPropertyValue(raw);
            if (display === '' && raw !== false && raw !== 0) return;
            addRow(propDl, humanizeLabel(key), display);
          });
          sub.appendChild(propDl);
          card.appendChild(sub);
        }
      }
      rootEl.replaceChildren(card);
    }

    try {
      const { default: HelpScout } = await import('https://esm.sh/@helpscout/javascript-sdk@0.10.0');
      const context = await HelpScout.getApplicationContext();
      const email =
        (context && context.customer && context.customer.emails && context.customer.emails[0] && context.customer.emails[0].value) ||
        (context && context.customer && context.customer.email) ||
        null;

      if (!email) {
        setStatus('');
        const p = document.createElement('p');
        p.className = 'muted';
        p.textContent = 'No customer email on this conversation yet.';
        rootEl.replaceChildren(p);
      } else {
        const url = new URL('/helpscout/klaviyo-profile', window.location.origin);
        url.searchParams.set('email', email);
        const res = await fetch(url.toString(), {
          headers: { Authorization: 'Bearer ' + API_TOKEN },
        });
        const body = await res.json().catch(function () { return {}; });
        if (!res.ok) {
          renderError((body && body.message) || ('Could not load profile (' + res.status + ')'));
        } else {
          setStatus('');
          const profile = body.data && body.data.profile;
          if (!profile) {
            const div = document.createElement('div');
            div.className = 'card';
            const p = document.createElement('p');
            p.className = 'muted';
            p.textContent = 'No Klaviyo profile for ';
            const strong = document.createElement('strong');
            strong.textContent = email;
            p.appendChild(strong);
            p.appendChild(document.createTextNode('.'));
            div.appendChild(p);
            rootEl.replaceChildren(div);
          } else {
            renderProfile(profile, email);
          }
        }
      }
    } catch (e) {
      console.error(e);
      renderError(e.message || 'Failed to load sidebar');
    }
  </script>
</body>
</html>`;
};

module.exports = { renderHelpScoutProfileSidebarPage };
