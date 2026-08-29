# Pending work

Everything here was intentionally left out of `bazzingo-backend-v2` because it
depends on a module that has not been migrated yet. Nothing below is lost work —
each entry names the source file in the old backend, the exact blocker, and the
moment it becomes safe to build.

Last updated: 2026-08-17

---

## 1. `GET /user/subscription-and-assessments`

- **Status: DONE** — implemented and mounted behind `requireAuth` in `src/modules/user/userRouter.js`; verified in the 2026-08-17 parity audit.

- **Old code**: `controllers/assessmentController.js` → `getUserSubscriptionAndAssessments` (line ~1080), mounted in `routes/userRouter.js`.
- **What it does**: returns the user's current subscription (active/trial/plan name/duration) together with their assessment availability.
- **Blocked by**: `Subscription`, `Plan`, `PriceCatalog` models and the assessment aggregation. None of them exist in v2.
- **Do it when**: the `subscription` and `assessment` modules are migrated. It is an aggregation over those two modules and belongs in the module that owns the data, not in `user`.
- **Note for the rewrite**: the old handler resolves the plan twice (by `planId`, then falling back to `priceCatalogId`) and logs with `console.log`. In v2 that resolution belongs in `subscriptionService`, logged through winston.

## 2. `GET /user/data-export` (GDPR export)

- **Status: DONE** — implemented in `src/modules/user/userAccountController.js` / `userDataService.js`; verified in the 2026-08-17 parity audit (V2 sections dropped per Q1).

- **Old code**: `controllers/dataExportController.js`, mounted in `routes/userRouter.js`.
- **What it does**: collects every personal-data collection for the authenticated user into one JSON export (`EXPORT_VERSION = '1.0'`).
- **Blocked by**: 13 models — `AssessmentScore`, `AdhdAssessmentScore`, `EmotionalIntelligenceAssessmentScore`, `GameScore`, `GamePlay`, `DailyGameSuggestion`, `UserDailyActivity`, `UserQuickAssignment`, `BadgeUnlock`, `Order`, `Subscription`, `Notification`, `Leaderboard`. All exist in v2 already; the modules that own them do not. `PaymentV2` and `SubscriptionV2` are excluded by decision — see Q1.
- **Do it when**: all of the modules above are migrated. Building it earlier means shipping a legally incomplete GDPR export, which is worse than not shipping it.
- **Note for the rewrite**: keep the `safeFind` behaviour (one unreadable collection must never fail the whole export), but log the failure with `logger.error` instead of `console.error`.

## 3. `POST /user/delete-account` (soft delete)

- **Status: DONE** — implemented in `src/modules/user/userAccountController.js`; Klaviyo `Account Deleted` event and Stripe metadata flagging verified in the 2026-08-17 parity audit. `subscriptionStatusAtDeletion` snapshots the legacy `Subscription` status where v1 read `SubscriptionV2` — confirmed by the owner on 2026-08-17 (stripe_v2 does not exist; legacy is the right source).

- **Old code**: `controllers/accountDeletionController.js`, mounted in `routes/userRouter.js`.
- **What it does**: soft-deletes the account and propagates the deletion to every downstream system.
- **Blocked by**: `Subscription` (blocking-subscription check), `PushSubscription`, `klaviyoService`, and the Stripe instance. `Leaderboard` and `AccountDeletionFeedback` are ready.
- **Do it when**: the `stripe`, `push` and `klaviyo` modules are migrated.
- **Already in v2**: the _read_ side of the soft delete is live. `src/common/middlewares/authenticate.js` rejects `isDeleted` accounts with `403` and `context.reason = "account_deleted"`, and the `isDeleted` / `deletedAt` / `deletionReason` fields are on the v2 user model — so a user soft-deleted by the old backend is already locked out of v2.
- **Already in v2**: `KLAVIYO_EVENTS.ACCOUNT_DELETED` and `KLAVIYO_PROFILE_PROPERTIES` are in `src/constants/index.js`, so the Klaviyo call has no literals left to hardcode.

---

## Open questions — need a decision from the owner

### Q1. `SubscriptionV2` and `PaymentV2` — RESOLVED, dropped

`stripe_v2` is excluded as a dummy stack, and on the owner's decision all four
of its models go: `PlanV2`, `PriceV2`, `SubscriptionV2`, `PaymentV2`.

Two consequences to carry into the modules that are not built yet:

- **`GET /user/data-export`** no longer includes the `SubscriptionV2` and
  `PaymentV2` sections that v1 exported. Every other collection is unchanged.
- **`POST /user/delete-account`** checks only the legacy `Subscription`
  collection for a blocking subscription. v1 checked `SubscriptionV2` first and
  fell back to `Subscription`.

Both are intended, not oversights. The collections themselves are untouched in
the database; v2 simply has no code that reads or writes them.

### Q12. Fixed during the parity audit — no decision needed

A forensic v1-vs-v2 audit of all 231 exported v1 functions found five critical
defects. All five are now fixed or accounted for:

1. **The Stripe webhook emitted no Klaviyo events.** `stripeWebhookRouter.js`
   constructed `new StripeService(logger, stripe, null, sendEmail)`, and every
   sync call is guarded by `if (!this.klaviyoSync?.syncSubscription) return`, so
   seven call sites silently no-opped. Since Stripe confirms nearly everything by
   webhook, every conversion-driven Klaviyo flow was dead with no error output.
   **Fixed** — the webhook router now builds the same sync the sibling routers do.
2. **The CORS allow-list had been dropped.** v1 hardcodes 14 production origins
   (`config/cors.js:1-16`); v2 fell back to `origin: true` with
   `credentials: true` when `ALLOWED_ORIGINS` was unset, which lets any site make
   authenticated cross-origin calls. **Fixed** — `src/config/cors.js` restores all
   14 origins plus v1's `www.` auto-expansion, and `ALLOWED_ORIGINS` now _adds_
   to that list instead of replacing it.
3. **Fatal process handlers were missing.** v1 exits on `uncaughtException` /
   `unhandledRejection`; v2 kept serving from a corrupt process. **Fixed** in
   `src/server.js`, now logging through winston before exit.
4. **Webhook Klaviyo calls were awaited** where v1 fires them without awaiting.
   A slow Klaviyo would delay the webhook ACK past Stripe's timeout and make
   Stripe retry the event. **Fixed** — the dispatch is non-blocking again.
5. **Cron is off by default.** Intentional, so v2 cannot double-run against a
   live v1. Set `JOBS_ENABLED=true` at cutover or the leaderboard ranks freeze
   and no daily challenge is created.

The audit also independently re-verified the model layer by loading every schema
through mongoose in both repos: **32 models, 377 paths, all indexes, zero
differences** — and confirmed all 126 routes have identical middleware chains.

### Q10. The same assessment scores differently depending on the route

There are **two** program-score formulas in v1 and they do not agree.

| v1 site                                  | small-sample branch                             |
| ---------------------------------------- | ----------------------------------------------- |
| `controllers/lpController.js:34`         | `Math.round(70 + (assessmentScore / 50) * 60)`  |
| `controllers/assessmentController.js:41` | `Math.round(70 + (assessmentScore / 150) * 60)` |

Everything else in that branch is identical (sample threshold 100, mean 100,
sd 15, clamp 0-200) — only the divisor differs, **50 vs 150**.

A raw score of 10 therefore becomes a program score of **82** when submitted
through the landing page and **74** when submitted through the app. The same
user, the same answers, two different numbers written to `programScore` and, for
`iq-test`, to `user.iq`.

Both are preserved exactly, and a spec pins each so a future "cleanup" that
unifies them fails loudly instead of silently changing everyone's scores.

**This needs a product decision, not a code decision**: which divisor is
correct? Whichever you pick, existing scores computed with the other one are
already in the database.

### Q11. `klaviyoSyncService.syncSubscription` — RESOLVED, migrated

Both halves are migrated. `syncSubscription` lives at
`src/modules/lp/klaviyoSyncService.js:471` (with `syncAssessmentPurchase`
alongside) and is wired into every v1 call site: the stripe webhook (created /
invoice-payment / all four elements branches), `POST /stripe/subscription/cancel`,
and `POST /stripe-elements/cancel-subscription`. Verified call-site-by-call-site
in the 2026-08-17 parity audit. The only v1 caller without a v2 counterpart is
`stripe_v2`'s cancel endpoint, which is excluded by owner decision.

One deliberate delta: the subscription-created, invoice-payment and legacy
cancel syncs are now fire-and-forget where v1 awaited them — same side effects
and error swallowing, the response just no longer waits for Klaviyo.

### Q9. The badge catalogue cache goes stale after a re-seed

`badgeService` caches the badge catalogue in memory and looks unlocks up by the
cached `_id`. `POST /badges/bulk-insert` does `deleteMany({})` then
`insertMany(...)`, which assigns **brand new `_id`s** to every badge.

In v1 `services/badgeService.js` exports a single shared instance whose cache is
never cleared, so after any bulk-insert every later unlock in that process is
written against a dead badge id — the `BadgeUnlock` row is created but its
`badgeId` points at a deleted document, and the unlock payload comes back with
`badge: null`.

**In v2** `replaceCatalogue()` clears the cache on the instance that performed
the re-seed, but each router constructs its own `BadgeService`, so the other
instances (auth, game, assessment) still hold the stale ids until the process
restarts. Better than v1, not fixed.

**The fix** is one of: share a single BadgeService instance across routers, or
have `checkAndUnlockBadges` re-read the badge by name instead of trusting the
cached `_id`. Both change nothing about the API. Not applied — it is a live
behaviour change and your call.

Practical impact today: only matters if `bulk-insert` is run against a live
process, which is an admin action.

### Q7. Bugs found in the parallel-migrated modules

All preserved unless noted. Each names the exact v1 site.

**translate — two hangs, both dropped (not ported).**

- `services/translateService.js:177` re-enters `performTranslationRequest` from
  _inside_ the lock chain (`rateLimitLock = rateLimitLock.then(...)`, line 115),
  so the retry awaits the promise that awaits it. The 403 rate-limit retry path
  could never complete. v2 throws v1's own intended message instead, copied
  verbatim from line 180: `"Translation rate limit exceeded after 3 retries.
Please try again later."` Dropped with it: `rateLimitUntil` and its in-request
  `setTimeout` of up to **1 hour**, plus the 1/2/4-minute backoff sleeps.
- Same line 115: one rejection poisons the module-level lock, so every later
  translation in the process rejects with a stale error. v2 uses
  `this.queue.then(run, run)`.

**certificate — `?format=png|jpg` never worked.**
`CertificateController.js:352` hardcodes `res.setHeader('Content-Type',
'application/pdf')` after computing the right value and discarding it. Only the
filename extension changes. Preserved and pinned by a spec. Also preserved: a
generation failure returns **200** with an HTML fallback, not a 5xx, and
`PLATFORM_NAME` is the empty string despite the comment claiming otherwise.

**klaviyo / helpscout — every validation error hung the request.**
v1 mounts bare `async` handlers that `throw HttpError` with no wrapper
(`klaviyoRouter.js:10`, `helpScoutRouter.js:8`), so on Express 4 each throw was
an unhandled rejection and the client waited forever. v2's `asyncWrapper` turns
these into the intended 400/401. Also: `helpScoutController.js:31` reads
`user.email` before its own `if (!user)` guard on line 33 — unreachable, dropped.
And `/klaviyo/profiles` can never page by more than 19 rows
(`klaviyoProxyService.js:14` sets `maxPageSize: 19` and line 137 clamps the
requested 100 down to it) — preserved.

**plan — several, all preserved.**
Stripe rollback keyed on `error.stripeProductId`, which Stripe errors never
carry (dead code); `intervalCount: "3"` is a 400 in `attachPriceToPlan` but
silently becomes `1` in `createDirectPlan`; `attachPlanPrices` writes price ids
with no existence check while `attachPriceToPlan` validates; `listPlans` divides
`unitAmount` by 100 while every other endpoint returns raw minor units.

### Q8. Two project-wide response deviations

These affect every module and are worth one decision rather than many.

1. **5xx messages are masked.** v1's error middleware returned the raw message
   on 500s; v2's `globalErrorHandler` returns `"Something went wrong"`. Status
   codes are identical and the real message is logged. This hides internal
   detail from clients, which is why it was built that way.
2. **Malformed input that v1 answered with a 500 now returns 400.** `asyncWrapper`
   maps mongoose `CastError` / `ValidationError` to 400 — e.g. a malformed
   `:planId` in the URL. No legitimate client depends on "500 means I sent a bad
   id".

Say the word if either should revert to v1 behaviour exactly.

### Q6. A junk string was removed from an ADHD error message

`controllers/adhdAssessmentController.js` in v1 throws this on a bad
`optionScores` entry:

```js
throw new HttpError(
    400,
    `optionScores[${i}] must be a number toa tu mari jode aye mara papa nai awi sake ane koine laijawu jaruri che toa mara papa tane lai jwanu ke che`,
);
```

The trailing text is personal notes that were committed into a user-facing API
error by accident. The proof is in the same repository: the emotional
intelligence controller is a line-for-line twin of the ADHD one, and its version
of this exact throw reads

```js
throw new HttpError(400, `optionScores[${i}] must be a number`);
```

**Current decision**: v2 uses the clean message in both modules. This restores
the intended text rather than inventing a new one, and the clean message is a
strict prefix of the v1 string, so any client matching on the prefix is
unaffected.

Tell me if that text was deliberate and it goes back verbatim.

### Q5. `POST /notifications` dropped a dead 10-second timer

v1 wraps the whole handler in `Promise.race([notificationPromise, timeoutPromise])`
where `timeoutPromise` is a bare `setTimeout(..., 10000)` that is never cleared.

The handler responds immediately (push dispatch is deliberately fire-and-forget),
so `notificationPromise` always wins the race. The timer can never affect the
response — it only keeps a pending timer alive for 10 seconds after every single
call to this endpoint.

**Current decision**: the race is dropped. The observable behaviour is
unchanged — `201` returns immediately, push dispatch still runs in the
background and still marks `pushSent`. What is gone is a per-request timer leak.

If you want the 10-second ceiling to be real rather than decorative, that is a
different change: it would mean awaiting the dispatch, which would make the
endpoint slow and would change its response time. Say so and I will build it
properly with a cleared timer.

### Q4. `POST /streak` writes one row per **user**, not one per **day**

`streakController.upsertDailyActivity` in v1 computes `today` and then never
uses it. The upsert filter is keyed on the user alone:

```js
const today = startOfDay(new Date());
const userDailyActivity = await UserDailyActivity.findOneAndUpdate(
    { userId: req.user._id },
    { $setOnInsert: { userId: req.user._id }, $set: update },
    { new: true, upsert: true },
);
```

Three consequences, all reproduced in v2 and all verified against the stored
document:

1. The inserted row has **no `date` field at all**, even though `date` is
   `required: true` on the schema — `findOneAndUpdate` does not run validators
   by default, so the write goes through.
2. There is one such row per user for all time. Calling the endpoint on day 2
   overwrites day 1 instead of adding a day.
3. It can collide with the rows `POST /game/score` writes. Those are correctly
   keyed `{ userId, date }`. A later `POST /streak` matches on `userId` alone,
   so it can update a real game-day row rather than its own.

`GET /streak` then computes streaks from `createdAt`, not `date`, which is why
the endpoint still returns plausible-looking data despite the above.

The fix is to key the upsert on `{ userId, date: today }` — which is exactly
what `streakService.markGamePlayed` already does. That is a one-line change, but
it changes what the endpoint stores, so it is your call.

### Q3. Two badges can never unlock in v1, and still cannot in v2

Both were migrated exactly as they behave in v1. Neither is a migration defect —
both are pre-existing, and fixing either changes who earns a badge, which is a
product decision.

**`top-10-champion` never unlocks.** `badgeService.checkTop10ChampionBadge` reads
the rank off the **User** document:

```js
const user = await User.findById(userId).select(
    "assessmentGlobalRank gameGlobalRank",
);
```

`assessmentGlobalRank` and `gameGlobalRank` do not exist on the User schema —
they live on **Leaderboard**. So both are always `undefined`, the check never
passes, and no user has ever earned this badge. The one-line fix is to read from
`leaderboardService.findByUserId(userId)` instead. Say the word and it changes.

**`bazingo-believer` counts timestamps, not days.**
`checkBazingoBelieverBadge` does `UserDailyActivity.distinct("createdAt", { userId })`
and requires 30 entries. `createdAt` is a full millisecond timestamp, so this
counts distinct _rows_, not distinct _days_. Since `UserDailyActivity` is unique
on `{ userId, date }` it is one row per day in practice, so the count is usually
right — but it is right by accident. Counting `date` would be correct.

### Q2. The `mainCategory_1` index drop was removed

`models/QuickMiniAssessment.js` in v1 ends with an unawaited `init()` that calls
`QuickMiniAssessment.collection.dropIndex('mainCategory_1')` inside an empty
`catch`. It runs **every time the model is imported**, so importing a model
performs a database write.

**Current decision**: the schema and its `{ fullAssessment: 1, order: 1 }` unique
index are copied verbatim; only the `init()` call is dropped. It is a one-off
cleanup that has already run in production, it contradicts the "no index change"
rule, and it swallows every error so it can never report failure.

**If the legacy index still exists in any environment**, drop it once by hand
instead:

```js
db.quickminiassessments.dropIndex("mainCategory_1");
```

Say the word and it goes back into the model exactly as it was.

---

## Modules not started yet

**ALL 126 v1 endpoints are migrated and mounted.** Verified by
`tests/routes/parity.spec.js`, which fails if any route is dropped or added.

| module         | endpoints | module            | endpoints    |
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

Plus `jobs` (daily challenge + leaderboard recompute, behind `JOBS_ENABLED`,
default off).

**Not started**: nothing. Every module above is migrated.

`stripe_v2` is excluded on the owner's instruction and is **not** pending work.
