# bazzingo-backend-v2

Full rewrite of the Bazzingo backend. JavaScript (CommonJS), one folder per
domain module, class-based controllers and services with constructor injection,
winston logging on every path, and a spec for every endpoint.

All **126** endpoints from the original backend are migrated and mounted.

## Structure

```
src/
  app.js                    express app, middleware order, route mounting
  server.js                 boot: db -> jobs -> listen -> graceful shutdown
  config/
    index.js                loads .env.<NODE_ENV>, fails loud on missing keys
    logger.js               winston: console + logs/combined.log + logs/error.log
    db.js                   connectDb / disconnectDb
    stripe.js               lazily built Stripe client, null when unconfigured
  constants/
    index.js                shared constants + re-exports every module file
    <module>.js             one constants file per module
  common/
    middlewares/            requestLogger, authenticate, requireAdmin,
                            globalErrorHandler, allowHelpScoutIframe,
                            requireHelpScoutAppAuth
    services/               shared base classes (categoryAssessmentService)
    controllers/            shared base classes (categoryAssessmentController)
    utils/                  response, wrapper, time, ageGroup, utmParams,
                            email, webPush, assessmentInput
  modules/<module>/         <module>Model.js  <module>Service.js
                            <module>Controller.js  <module>Router.js
  jobs/                     index.js, dailyChallengeJob.js, leaderboardJob.js
tests/
  utils/                    in-memory mongo, fixtures
  <module>/                 specs per endpoint
  e2e/                      full user journeys through the real app
  routes/parity.spec.js     asserts all 126 v1 endpoints are mounted
  models/schema-parity.spec.js  asserts all 32 models keep their v1 collection
logs/                       written at runtime, gitignored
```

Rules: no comments in `src/` or `tests/`, prettier-formatted, no `console.*`,
every message and event name lives in `constants/`.

## Modules

| Module         | Endpoints | Module            | Endpoints    |
| -------------- | --------- | ----------------- | ------------ |
| `auth`         | 11        | `assessment`      | 19           |
| `admin`        | 2         | `adhd-assessment` | 6            |
| `user`         | 6         | `ei-assessment`   | 6            |
| `game`         | 10        | `dashboard`       | 3            |
| `leaderboard`  | 1         | `plan`            | 5            |
| `streak`       | 2         | `price-catalog`   | 1            |
| `push`         | 3         | `stripe`          | 10 + webhook |
| `badge`        | 3         | `stripe-elements` | 14           |
| `notification` | 10        | `klaviyo`         | 3            |
| `certificate`  | 1         | `helpscout`       | 3            |
| `translate`    | 1         | `lp`              | 5            |

Plus `jobs`: the daily challenge and the 15-minute leaderboard rank recompute.

## Layers

`router` wires dependencies → `controller` validates the request, shapes the
response, logs the request lifecycle → `service` owns the database and the
external clients and logs the persistence lifecycle → `model` is the schema.

Every external client (Stripe, Klaviyo, HelpScout, Google, SMTP, web-push,
Puppeteer) is **injected through a constructor**, so no test can reach the
network and a missing key degrades to a logged failure instead of a crash.

## Logging

Every request gets an `x-request-id`. That `requestId` rides on every log line
the request produces — request in, auth result, controller decision, service
query, external call, response out, and errors. Logs go to console and to
`logs/` at the project root simultaneously. Only `NODE_ENV=test` is silent.

## Setup

```bash
npm install
cp .env.example .env.development   # fill in the keys you need
npm run dev
```

Every variable except `PORT`, `MONGO_URI` and `JWT_SECRET` is optional with a
safe default — an unset integration key disables that integration rather than
breaking boot.

## Testing

```bash
npm test
npm run test:watch
```

`mongodb-memory-server` gives each suite a real MongoDB with real indexes, so
unique constraints are enforced exactly as in production. No test touches the
network.

## Background jobs

Behind `JOBS_ENABLED` (default `false`) so v2 cannot double-run cron while the
old backend is still live. Set it to `true` only after the old backend is off.

## Klaviyo profile properties

Acquisition attribution (`utmSource`, `utmCampaign`, `utmMedium`) is fixed on
users and landing-page hooks after creation, including the `organic` fallback.
New email visits and later purchases cannot replace it. Stripe, Klaviyo and
Help Scout use the saved user values; email attribution stays separate.
Missing, blank and legacy `default` values are repaired to `organic` before
purchase or landing-page synchronization, without changing existing real values.

Custom profile keys sent by the backend use `bazzingo:` followed by lowercase
words separated by underscores. For example, `resume_url` becomes
`bazzingo:resume_url`, `Current Plan name` becomes `bazzingo:current_plan_name`,
and `assessmentId` becomes `bazzingo:assessment_id`. This rule is applied by
`upsertProfileByEmail` to profile imports and their local backups. Klaviyo's
built-in attributes and event properties retain their existing names.

Profile attribution keys use the full names `bazzingo:utm_source`,
`bazzingo:utm_campaign`, `bazzingo:utm_medium` and `bazzingo:utm_email`.
Email attribution is separate from the original UTM medium. Landing-page hook
creation, updates, resume queries and signup accept `flowId`, `flow_id`,
`klaviyo_flow_id` or `utm_id`. The frontend must forward the ID from the clicked
link; the backend cannot read a visitor's browser URL. Use `utm_id` only for
flow messages configured with Flow ID; campaign IDs are not flow IDs.
The ID is saved separately as `flowId` for profile history and sent to Klaviyo
profiles as `bazzingo:flow_id`. Historical user `flowId` and `utmEmail` values
must never attribute a new purchase. Purchase requests explicitly supply their
current link attribution, which is kept in request-local state and sent to
Stripe as `flow_id` and `utm_email`; organic purchases omit both. Customer
metadata contains only the fixed acquisition UTMs.
Subscription activation restores the snapshot from its SetupIntent (or the
original PaymentIntent after 3DS). Existing subscriptions retain their own
snapshot for renewals. The `flow` metadata key identifies an internal payment
path used by webhook routing, not Klaviyo attribution.
This does not backfill attribution onto old Stripe objects.

Update email links to `{{ person|lookup:'bazzingo:resume_url' }}` and password
reset links to `{{ person|lookup:'bazzingo:reset_password' }}`. Update any flow
filters, segments and other templates referencing the old custom keys before
deploying. Existing remote profiles receive new keys on their next sync; this
change does not backfill or remove old remote or backup properties.

## Migration documents

- [MIGRATION.md](./MIGRATION.md) — the plan, the endpoint inventory, the rules
- [pending.md](./pending.md) — every deliberate deviation and open question
