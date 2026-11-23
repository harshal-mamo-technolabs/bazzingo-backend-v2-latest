// Keep survey values aligned with the web application's Subscription.jsx.
const CANCEL_REASONS = [
    "I wasn't using it often enough",
    "Too expensive.",
    "Didn't find the value worth the cost.",
    "It didn't meet my needs or expectations.",
    "Features I needed were unavailable.",
    "Reports or insights were too basic.",
    "I encountered technical problems.",
    "Poor app performance or usability issues.",
    "Information was repetitive or unhelpful.",
    "Other",
];
const STAY_OPTIONS = [
    "Lower-cost subscription",
    "Annual discounted rates",
    "Additional Premium content",
];
const escape = (value) =>
    String(value).replace(
        /[&<>"']/g,
        (c) =>
            ({
                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                '"': "&quot;",
                "'": "&#39;",
            })[c],
    );
const date = (value) =>
    value
        ? new Date(value).toLocaleDateString("en-GB", {
              day: "numeric",
              month: "short",
              year: "numeric",
              timeZone: "UTC",
          })
        : "the current period end";
const page = (
    content,
    context,
) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Bazzingo · Subscriptions</title><style>
:root{color-scheme:light;--ink:#19253a;--muted:#59677a;--line:#dfe5ed;--red:#b42332;--navy:#19253a}
*{box-sizing:border-box}html{height:auto}body{margin:0;padding:12px;font:14px/1.5 system-ui,sans-serif;color:var(--ink);background:#fff;overflow-wrap:anywhere}
header{padding:0 0 12px;border-bottom:1px solid var(--line);margin-bottom:14px}h1{font-size:18px;line-height:1.3;margin:3px 0 0;letter-spacing:-.3px}header small{font-size:10px;letter-spacing:1.4px;color:#285a9a;font-weight:700}
small,.muted{color:var(--muted)}small{font-size:12px}h2{font-size:11px;letter-spacing:1px;text-transform:uppercase;color:var(--muted);margin:0 0 12px}p{margin:8px 0}section{border:1px solid var(--line);border-radius:10px;padding:14px;margin:12px 0;box-shadow:0 2px 4px #19253a04}.plan-heading{display:flex;align-items:center;justify-content:space-between;gap:8px}.plan-heading strong{font-size:17px;line-height:1.3}.badge{display:inline-block;flex-shrink:0;background:#eaf5ee;color:#236442;padding:3px 8px;border-radius:20px;font-size:11px;font-weight:600}.badge.attention{background:#eef2f6;color:var(--muted)}.badge.ending{background:#fff3df;color:#805719}.period{font-size:12px;color:var(--muted);margin:7px 0 12px}
button,select,textarea{font:inherit;width:100%;border:1px solid #cdd5e0;border-radius:6px;padding:10px;background:#fff;color:var(--ink);min-width:0}button{min-height:42px;cursor:pointer;font-weight:600;margin-top:10px}button.danger{color:white;background:var(--red);border-color:var(--red)}button:hover{background:#f3f5f8}button.danger:hover{background:#951d2a}button:disabled{cursor:wait;opacity:.6}button:focus-visible,select:focus-visible,textarea:focus-visible,input:focus-visible,summary:focus-visible{outline:3px solid #2563eb;outline-offset:2px}
label{display:block;font-size:13px;font-weight:500;margin:14px 0 6px}fieldset{border:0;border-top:1px solid var(--line);padding:14px 0 0;margin:16px 0}legend{font-size:13px;font-weight:600;padding:0 0 4px}input[type=checkbox]{flex:0 0 16px;width:16px;height:16px;margin:3px 9px 0 0;accent-color:var(--navy)}.check{display:flex;align-items:flex-start;min-height:38px;padding:8px 0;margin:0;font-size:13px;font-weight:400}.confirm{background:#f6f8fb;border-radius:6px;padding:10px;margin-top:14px}.notice,.error{border-radius:6px;padding:10px 12px;font-size:13px}.notice{background:#edf7f1;color:#236442}.error{background:#fff1f2;color:var(--red)}
details{border-top:1px solid var(--line);margin-top:12px}summary{cursor:pointer;min-height:44px;display:flex;align-items:center;justify-content:space-between;gap:8px;color:var(--red);font-size:13px;font-weight:600;list-style:none}summary::-webkit-details-marker{display:none}summary::after{content:'+';font-size:20px;font-weight:400}details[open]>summary::after{content:'−'}details[open]>summary{margin-bottom:6px}textarea{resize:vertical;min-height:80px}form{margin:0}.customer{font-size:12px;color:var(--muted);margin:0 0 12px}.footnote{font-size:12px;color:var(--muted);margin:14px 0 0}[hidden]{display:none!important}
</style></head><body><header><small>BAZZINGO</small><h1>Subscriptions</h1></header><main id="sidebar-panel">${content}</main>${context ? `<div hidden id="sidebar-config" data-token="${escape(context.token)}" data-context-id="${escape(context.id)}"></div><script type="module" src="/helpscout/billing-sidebar/client.js"></script>` : ""}</body></html>`;

function renderSubscription(
    session,
    subscription,
    token,
    context,
    message = "",
    error = "",
) {
    const hidden = `<input type="hidden" name="token" value="${escape(token)}">`;
    const ending = subscription?.cancelAtPeriodEnd;
    const renewable =
        subscription &&
        ["active", "trialing", "past_due", "unpaid"].includes(
            subscription.status,
        );
    const name =
        subscription?.priceCatalogId?.planId?.name ||
        (subscription?.planDuration === "yearly"
            ? "Yearly membership"
            : subscription?.planDuration === "monthly"
              ? "Monthly membership"
              : "Membership");
    const end = subscription?.cancelAt || subscription?.currentPeriodEnd;
    const form = `<details><summary>Cancel subscription renewal</summary><form method="post" action="/helpscout/billing-sidebar/cancel">${hidden}<p>Access continues until ${escape(date(end))}.${subscription?.status === "trialing" ? " The trial will not convert to a paid subscription." : ""}</p><label for="reason">Why is the customer cancelling? *</label><select id="reason" name="reason" required><option value="">Select a reason</option>${CANCEL_REASONS.map((r) => `<option>${escape(r)}</option>`).join("")}</select><div id="other-details" hidden><label for="other">Details for “Other” (optional)</label><textarea id="other" name="other" maxlength="500" disabled></textarea></div><fieldset><legend>Would they have stayed if offered? *</legend><small>Select at least one. These survey answers do not apply an offer.</small>${STAY_OPTIONS.map((o) => `<label class="check"><input type="checkbox" name="wouldHaveStayedIfOffered" value="${escape(o)}">${escape(o)}</label>`).join("")}</fieldset><label class="check confirm"><input type="checkbox" name="confirmed" value="yes" required>Confirm cancellation of subscription renewal</label><button class="danger">Cancel renewal</button></form></details>`;
    return page(
        `<p class="customer">${escape(session.email)}</p>${message ? `<p role="status" class="notice">${escape(message)}</p>` : ""}${error ? `<p role="alert" class="error">${escape(error)}</p>` : ""}<section><h2>Subscription</h2>${subscription ? `<div class="plan-heading"><strong>${escape(name)}${subscription.status === "trialing" ? " trial" : ""}</strong><span class="badge${ending ? " ending" : renewable && !["past_due", "unpaid"].includes(subscription.status) ? "" : " attention"}">${ending ? "Ending" : subscription.status === "trialing" ? "Trial" : escape(subscription.status.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()))}</span></div><p class="period">${ending ? "Ends" : "Current period ends"} ${escape(date(end))}</p>${ending ? '<p class="notice">Renewal already cancelled.</p>' : renewable ? form : '<p class="muted">No renewable subscription to cancel.</p>'}` : '<p class="muted">No subscription found for this account.</p>'}</section><p class="footnote">Cancelling stops future renewals and keeps access until the period ends.</p><form method="post" action="/helpscout/billing-sidebar/refresh">${hidden}<button>Refresh subscription</button></form>`,
        context,
    );
}
module.exports = {
    CANCEL_REASONS,
    STAY_OPTIONS,
    escape,
    page,
    renderSubscription,
};
