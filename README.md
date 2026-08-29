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

## Migration documents

- [MIGRATION.md](./MIGRATION.md) — the plan, the endpoint inventory, the rules
- [pending.md](./pending.md) — every deliberate deviation and open question
