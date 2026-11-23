# Bazzingo subscription panel in Help Scout

The **Bazzingo** app displays subscription status, trial status, billing period end, and scheduled cancellation in **Testbrain Inbox** (`365852`). It supports both tickets and active live chats. Agents use the same cancellation reasons and retention survey as the web app. At least one retention answer is required by the existing Bazzingo cancellation service.

Cancellation always stops renewal at the end of the current period. This panel does not offer immediate cancellation, refunds, purchases, or subscription changes. The existing Stripe service persists the survey, updates Stripe, and synchronizes Klaviyo. One-time assessment purchases have no renewal to cancel.

## Deploy

Deploy the backend changes, including `conf/nginx/default.conf`, and restart/rebuild the backend container. This project does not need a frontend build for the sidebar. The client is served from `src/modules/helpscout/billingSidebarClient.js`, using the same pinned Help Scout SDK CDN as the existing profile sidebar.

Set these runtime variables:

- `HELP_SCOUT_BILLING_SECRET`: a dedicated 40-character signing key. The local setup value is in the gitignored `logs/helpscout-billing.env` file and in local `.env.development` / `.env.production`. Transfer it through the deployment environment settings; do not commit it.
- `HELP_SCOUT_BILLING_INBOX_ID=365852`.
- `HELP_SCOUT_MAILBOX_APP_ID` and `HELP_SCOUT_MAILBOX_APP_SECRET`: the existing server-side Help Scout Inbox API credentials.

Do not reuse `HELP_SCOUT_APP_SECRET` or `HELP_SCOUT_SECRET`: the existing profile panel uses those for a different purpose. The billing app never embeds a permanent secret in HTML or JavaScript.

## Install in Help Scout

Open **Settings → Workspace → Apps → Create → Create App**:

1. App name: **Bazzingo**.
2. Content URL: `https://api.testbrain.net/helpscout/billing-sidebar` (no query parameters).
3. Content signature key: the exact `HELP_SCOUT_BILLING_SECRET` from the deployed backend.
4. Leave Side Panel URLs empty.
5. Save and enable the app only for **Testbrain Inbox**.

For an existing installation, retain its signing key and inbox assignment, and verify its Content URL is `https://api.testbrain.net/helpscout/billing-sidebar`. Deploy the backend before switching a callback from another host. The app gives authorized Testbrain inbox agents subscription viewing and cancellation access.

The Nginx configuration omits `X-Frame-Options` only on `/helpscout/billing-sidebar` and its subroutes. The app's CSP allows embedding only by `https://secure.helpscout.net`. If an external hosting proxy also injects `SAMEORIGIN`, apply the same path-specific exception there.

## Verify

Unsigned requests to the callback must return 401. Missing billing configuration returns 503. Open a ticket and a live chat for a designated test account, and confirm the selected customer's email, plan/trial and end date. Switch customers to verify the panel follows the selection. Refresh should keep the current customer binding.

Only test cancellation on an explicitly authorized test subscription. Confirm cancellation in the panel, Stripe, and the web app. No real subscription was cancelled during implementation; automated tests mock Stripe updates.

## Authorization and limits

Help Scout callback signatures are validated on the server. Short-lived, purpose-specific tokens bind actions to the signed agent, verified Help Scout customer, Bazzingo user and displayed Stripe subscription. The server checks actual Bazzingo inbox membership, excludes light users, and fetches the customer email from Help Scout instead of trusting browser-supplied email/account IDs. The customer and subscription are rechecked before every action. A replaced subscription requires a refresh. The audit log records the agent, Help Scout context, account, subscription and reason.

The existing cancellation service targets one subscription per user. If the panel finds multiple subscription records or a contact matching multiple Bazzingo accounts, it stops with a review message rather than picking a target. Recurring profile add-ons are not part of Bazzingo's current subscription model.

Treat signed callback URLs and form tokens as sensitive. Help Scout's callback signature protocol does not include an expiry; form and context tokens expire after fifteen minutes.

## Sidebar layout

The subscription panel uses the same layout as AstroMeridian: clear plan and status cards, end dates, expandable cancellation details, a highlighted confirmation, and an automatic iframe height that follows content changes. Details for “Other” appear only when that reason is selected. Bazzingo still requires at least one retention answer, and all existing server-side cancellation checks remain in place. Trials, scheduled cancellations, empty accounts and error messages use the same layout.

After redeployment, reload the Help Scout conversation to load the updated browser module. The production callback is `https://api.testbrain.net/helpscout/billing-sidebar`; routes and browser requests use the same host automatically. An unsigned request returns 401 once the route is deployed (404 means it is not present yet). There is no additional frontend build step or new environment variable for the layout refinement.
