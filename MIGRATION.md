# Bazzingo backend v1 → v2 migration plan

Source of truth: `../bazzingo-backend`. Nothing in this document is optional.
Every endpoint listed here must exist in v2 with the same path, the same method,
the same auth, the same request body and the same response body.

Last updated: 2026-08-14

---

## Scale

| Thing         | Count                                      |
| ------------- | ------------------------------------------ |
| HTTP endpoint | 125                                        |
| Webhook       | 1 (Stripe v1)                              |
| Model         | 32                                         |
| Service       | 10                                         |
| Cron job      | 2 (daily challenge, leaderboard recompute) |
| Source lines  | ~17,000                                    |

### Excluded on the owner's instruction: `stripe_v2`

`stripe_v2` is a dummy stack that is not in use, so it is **not migrated**. That
drops `routes/stripeRouter_v2.js` (16 endpoints), `controllers/stripeController_v2.js`,
`services/stripe_v2.js`, `webhook/stripeWebhook_v2.js`, and all four of its
models: `PlanV2`, `PriceV2`, `SubscriptionV2` and `PaymentV2`.

`SubscriptionV2` and `PaymentV2` were read by `dataExportController` and
`accountDeletionController`. On the owner's decision those reads are dropped
too: the GDPR export no longer carries V2 subscription and payment sections, and
`delete-account` checks only the legacy `Subscription` collection for a blocking
subscription. Recorded in `pending.md`.

---

## Non-negotiable rules

1. **No database change.** Schemas are copied field for field. No field is
   added, removed, renamed, retyped, or given a different default. No index
   changes. No `timestamps` added or removed.
2. **Model registration names are frozen**, because mongoose derives the
   collection name from them. Watch the two traps:
    - `models/UserQuickAssignment.js` registers as **`DailyQuickAssignment`**
      (collection `dailyquickassignments`), not `UserQuickAssignment`.
    - `models/PriceCatalog.js` and `models/QuickMiniAssessment.js` assign to a
      `const` before exporting. Keep the registered string identical.
3. **No response change.** Same status codes, same `{status, message, data,
context}` envelope, same field names inside `data`. The frontend must not
   need a single edit.
4. **No route change.** Same mount path, same sub-paths, same trailing
   `/:params`, same HTTP verbs, same middleware order. Quirks are preserved,
   including the duplicated `router.use(requireAuth)` chains and the commented
   out `requireAdmin()` on `GET /assessment` and `POST /assessment`.
5. **JWT stays compatible.** Same secret, same `{ userId }` payload, same
   `Bearer` header. Tokens issued by v1 must work on v2 and vice versa.
6. **TDD.** Spec first, watch it fail, then implement. One spec file per
   endpoint under `tests/<module>/`.
7. **Logging everywhere.** Every controller and every service method logs entry,
   outcome and failure through winston, carrying `requestId` and `userId`.
   No `console.log` survives the migration.
8. **Zero comments, prettier formatted, constants in `src/constants/index.js`.**
9. **External calls are never made in tests.** Stripe, Klaviyo, HelpScout,
   Google, SMTP, web-push and Puppeteer are injected and mocked.

---

## Target layout

```
src/
  app.js
  server.js
  config/          index.js  logger.js  db.js  stripe.js  cors.js
  constants/       index.js
  common/
    middlewares/   requestLogger  authenticate  requireAdmin  globalErrorHandler
    utils/         response  wrapper  time  ageGroup  parseUtmParams  email  push
  modules/
    <module>/      <module>Model.js  <module>Service.js  <module>Controller.js  <module>Router.js
  jobs/            index.js  dailyChallengeJob.js  leaderboardJob.js
tests/
  utils/           db.js  fixtures.js  mocks/
  <module>/        one spec file per endpoint
```

A module owns the models whose data it is responsible for. Cross-module reads go
through the owning module's **service**, never through another module's model.

---

## Phases

Phases are ordered by dependency. A phase may not start before the phase it
depends on is green.

### Phase 0 — foundation — **DONE**

- [x] All 32 models copied verbatim into their owning module folder.
- [x] Schema parity verified path-by-path against v1: field names, types,
      `required`, defaults, enums, refs, `unique`, `sparse`, `index`,
      `lowercase`, `min`, `max`, and every nested subdocument. Zero drift.
- [x] All 32 collection names verified frozen, including the four traps:
      `DailyQuickAssignment→dailyquickassignments`,
      `DailySuggestion→dailysuggestions`,
      `KlaviyoBackup→klaviyo_backups`,
      `AccountDeletionFeedback→account_deletion_feedback`.
- [x] `tests/models/schema-parity.spec.js` locks the model→collection map so a
      future rename fails the suite (36 assertions).

Deferred deliberately (YAGNI — built with their first consumer, not before):
`config/stripe.js`, `config/cors.js`, `requireAdmin`, and the shared utils
(`time`, `ageGroup`, `parseUtmParams`, `email`, `push`).

Original scope of this phase, for reference:

- `config/stripe.js` (from `instance/index.js`), `config/cors.js`.
- `common/middlewares/requireAdmin.js` (from `middleware/adminMiddleware.js`).
- `common/utils/`: `time`, `ageGroup`, `parseUtmParams`, `email`, `push`,
  `stripeUtmMetadata`.
- `constants/index.js` extended: cancellation survey, badge data, roles,
  Klaviyo events and properties, Stripe statuses.
- Test helper upgrades: model factories, external-service mocks.

### Phase 1 — auth and identity

| Module  | Endpoints | Depends on                                             |
| ------- | --------- | ------------------------------------------------------ |
| `auth`  | 11        | user, klaviyo, leaderboard, assessment (quick), email  |
| `admin` | 2         | —                                                      |
| `user`  | 6         | leaderboard, subscription, assessment, klaviyo, stripe |

`auth` is the gate for everything else, but three of its endpoints
(`signup-lp`, `sync-assessment-submission-lp`, `refresh-token-lp`) reach into
the landing-page and assessment modules. Build the core five first
(`signup`, `login`, `google-login`, `forgot-password`, `reset-password`), then
return for the landing-page ones in Phase 6.

### Phase 2 — core domain — **DONE**

- [x] `badge` 3, `game` 10, `streak` 2, `push` 3, `notification` 10.
- [x] `common/utils/webPush.js` — web-push wrapper, injected into the
      notification service so no test ever reaches a push endpoint.
- [x] VAPID keys added to config as optional env, so a missing key degrades to a
      logged failure instead of a boot crash.

- [x] `badge` — 3 of 3 endpoints, plus the full unlock engine (15 badges) that
      `game`, `streak`, `assessment` and `auth` all call into.
- [x] `requireAdmin` middleware, built with its first consumer
      (`POST /badges/bulk-insert`).
- [x] `game` — 10 of 10 endpoints.
- [x] `leaderboardService.addGameScore` / `addAssessmentScore`, built with their
      first consumer (`POST /game/score`).
- [x] `streakService.markGamePlayed` / `markAssessmentCompleted`, built with
      their first consumer.
- [x] `streak` — 2 of 2 endpoints. v1's user-keyed upsert bug preserved and
      documented as Q4 in `pending.md`.
- [x] `push` — 3 of 3 endpoints.
- [x] `common/utils/time.js` — `getCETMidnight` verified identical to v1 across
      DST boundaries, plus the week helpers.

| Module         | Endpoints | Depends on               |
| -------------- | --------- | ------------------------ |
| `badge`        | 3 done    | user, game, assessment   |
| `game`         | 10 done   | user, leaderboard, badge |
| `streak`       | 2 done    | user, badge              |
| `badge`        | 3         | user, game, assessment   |
| `push`         | 3 done    | user                     |
| `notification` | 10 done   | user, admin, push        |

### Phase 3 — assessments — in progress

- [x] `adhd-assessment` 6, `ei-assessment` 6.
- [x] `stripe/orderService.js` — read-only order lookups, built with its first
      consumer (assessment purchase checks). The stripe endpoints come in Phase 4.
- [x] `common/services/categoryAssessmentService.js` and
      `common/controllers/categoryAssessmentController.js` — the ADHD and EI
      controllers are line-for-line twins in v1, differing only in category keys
      and labels, so both modules extend one base instead of duplicating ~400
      lines. Each module keeps its own model, service, controller and router
      files.

| Module            | Endpoints | Depends on                                                  |
| ----------------- | --------- | ----------------------------------------------------------- |
| `assessment`      | 19        | user, leaderboard, badge, plan, price-catalog, subscription |
| `adhd-assessment` | 6         | user, assessment                                            |
| `ei-assessment`   | 6         | user, assessment                                            |
| `dashboard`       | 3         | game, assessment, streak, badge                             |

### Phase 4 — billing

Two live Stripe stacks (`stripe` and `stripe-elements`) both stay. They are not
merged, not deduplicated, and not "cleaned up" — clients depend on both. The
third, `stripe_v2`, is excluded; see the note under Scale.

| Module            | Endpoints    | Notes                              |
| ----------------- | ------------ | ---------------------------------- |
| `plan`            | 5            | Plan only, PlanV2 dropped          |
| `price-catalog`   | 1            | PriceCatalog only, PriceV2 dropped |
| `stripe`          | 10 + webhook | legacy checkout / subscription     |
| `stripe-elements` | 14           | Elements-based payments and orders |

### Phase 5 — integrations

| Module        | Endpoints | Notes                                             |
| ------------- | --------- | ------------------------------------------------- |
| `klaviyo`     | 3         | + sync service and backup model                   |
| `helpscout`   | 3         | + iframe middleware, app auth, sidebar template   |
| `translate`   | 1         | Google Translate proxy with its cache             |
| `certificate` | 1         | Puppeteer render, needs the shutdown cleanup hook |

### Phase 6 — landing page and jobs

| Module | Endpoints | Notes                                           |
| ------ | --------- | ----------------------------------------------- |
| `lp`   | 5         | + the three deferred `auth` LP endpoints        |
| `jobs` | —         | daily challenge cron, leaderboard 15m recompute |

### Phase 7 — cutover

- [x] Full endpoint diff v1 vs v2 — `tests/routes/parity.spec.js` asserts all
      126 v1 endpoints are mounted and that the only addition is `GET /health`.
- [x] Schema parity — all 32 models verified byte-identical to v1, locked by
      `tests/models/schema-parity.spec.js`.
- Response shape diff against recorded v1 responses.
- Point staging at v2, run the frontend against it.

---

## Definition of done, per module

A module is done only when all of these are true.

- [ ] Every endpoint from the inventory below is mounted, same path and verb.
- [ ] Model is byte-equivalent in shape to v1 and registers the same name.
- [ ] Controller is a class, service is a class, both take `logger` in the constructor.
- [ ] Router wires the dependencies, no logic in the router.
- [ ] Every endpoint has a spec file covering success, validation failure, auth failure and persistence.
- [ ] No `console.*`, no comments, prettier clean.
- [ ] Every literal that is a message, an event name or a field list lives in `constants/index.js`.
- [ ] `pending.md` updated if anything is deferred, with the reason.

---

## Endpoint inventory

Mount paths are as in `server.js`. `A` = requireAuth, `AD` = requireAdmin, `–` = public.

### `/auth` → `auth` (11)

| Verb | Path                             | Handler                    | Auth |
| ---- | -------------------------------- | -------------------------- | ---- |
| POST | `/signup`                        | signup                     | –    |
| POST | `/signup-lp`                     | signupLp                   | –    |
| POST | `/signup-msisdn`                 | signupMsisdn               | –    |
| POST | `/sync-assessment-submission-lp` | syncAssessmentSubmissionLp | –    |
| POST | `/refresh-token-lp`              | refreshTokenLp             | –    |
| POST | `/login`                         | login                      | –    |
| POST | `/login-msisdn`                  | loginMsisdn                | –    |
| POST | `/google-login`                  | googleLogin                | –    |
| POST | `/forgot-password`               | forgotPassword             | –    |
| POST | `/forgot-password/:token`        | resetPasswordWithToken     | –    |
| POST | `/reset-password`                | resetPassword              | A    |

### `/admin` → `admin` (2)

| POST | `/signup` | signup | – |
| POST | `/login` | login | – |

### `/user` → `user` (6)

| GET | `/` | getUserProfile | A | **done** |
| PUT | `/` | updateUserProfile | A | **done**, leaderboard sync pending |
| PUT | `/preferences` | updateNotificationPreferences | A | **done** |
| GET | `/subscription-and-assessments` | getUserSubscriptionAndAssessments | A | pending |
| GET | `/data-export` | exportUserData | A | pending |
| POST | `/delete-account` | deleteAccount | A | pending |

### `/game` → `game` (10)

| POST | `/games` | createGame | AD superadmin |
| GET | `/games` | listGames | – |
| GET | `/games/stats` | gamesStats | A |
| POST | `/play` | trackPlay | A |
| GET | `/recent` | recentlyPlayed | A |
| GET | `/suggestions/daily` | getDailySuggestions | A |
| GET | `/stats/unique-games` | uniqueGamesCount | A |
| POST | `/score` | submitScore | A |
| GET | `/stats/weekly-scores` | getCurrentWeekScores | A |
| GET | `/statistics` | getGameStatistics | A |

### `/assessment` → `assessment` (19)

| GET | `/` | getFullAssessments | A |
| POST | `/` | createFullAssessment | – (admin commented out in v1, keep) |
| POST | `/:fullAssessmentId/questions` | addFullAssessmentQuestions | – |
| POST | `/:fullAssessmentId/generate-quick` | generateQuickMiniAssessments | – |
| GET | `/quick/:id` | getQuickMiniAssessmentById | – |
| POST | `/submit` | submitAssessmentScore | A |
| GET | `/quick` | getTodaysAssignedQuick | A |
| GET | `/recent-activity` | getLatestAssessmentScores | A |
| GET | `/program-score` | getUserProgramScores | A |
| GET | `/program-scores-only` | getUserProgramScoresOnly | A |
| GET | `/score/:scoreId` | getAssessmentScorePublic | – |
| GET | `/subscription-and-assessments` | getUserSubscriptionAndAssessments | A |
| GET | `/statistics` | getAssessmentStatistics | A |
| GET | `/daily-assessment-purchase-recommendation` | getDailyRecommendedAssessment | A |
| GET | `/current-mini-assessment-purchase-status` | getCurrentMiniAssessmentWithPurchaseStatus | A |
| GET | `/user/full-scores` | getUserFullAssessmentScores | A |
| GET | `/user/submitted-full-assessments` | getUserSubmittedFullAssessments | A |
| POST | `/attach-price` | attachAssessmentPrice | AD |
| GET | `/:id` | getFullAssessmentById | – |

Route order matters: `/:id` is last, `/quick` before `/quick/:id`.

### `/assessment/adhd` → `adhd-assessment` (6)

| POST | `/` | createAdhdAssessment | – |
| POST | `/submit` | submitAdhdAssessmentScore | A |
| GET | `/report` | getAdhdAssessmentReportsList | A |
| POST | `/:adhdAssessmentId/questions` | addAdhdAssessmentQuestions | – |
| GET | `/:adhdAssessmentId/report` | getAdhdAssessmentReportSummary | A |
| GET | `/:adhdAssessmentId` | getAdhdAssessmentById | – |

### `/assessment/emotional-intelligence` → `ei-assessment` (6)

Same six shapes as ADHD, with `:eiAssessmentId`.

### `/dashboard` → `dashboard` (3)

| GET | `/` | getDashboardStats | A |
| GET | `/recent-activity` | getRecentActivity | A |
| GET | `/daily-streak-status` | getDailyStreakStatus | A |

### `/leaderboard` → `leaderboard` (1)

| GET | `/` | getLeaderboard | A |

### `/streak` → `streak` (2)

| POST | `/` | upsertDailyActivity | A |
| GET | `/` | getStreakData | A |

### `/notifications` → `notification` (10)

| GET | `/my-notifications` | fetchMyNotifications | A |
| POST | `/:id/acknowledge` | markAsRead | A |
| POST | `/minimal` | minimalTest | – |
| POST | `/debug-admin` | debugAdminMiddleware | – |
| POST | `/test` | testNotification | AD |
| GET | `/` | listNotifications | AD |
| POST | `/` | createNotification | AD |
| GET | `/:id` | getNotification | AD |
| PUT | `/:id` | updateNotification | AD |
| DELETE | `/:id` | deleteNotification | AD |

`minimalTest` and `debugAdminMiddleware` are debug endpoints. They are migrated
as-is; deleting them is a separate decision for the owner, not for the migration.

### `/push` → `push` (3)

| POST | `/subscribe` | subscribe | A |
| POST | `/unsubscribe` | unsubscribe | A |
| GET | `/status` | getPushSubscriptionStatus | A |

### `/badges` → `badge` (3)

| GET | `/` | getAllBadges | – |
| GET | `/ranks-and-badges` | getUserRanksAndBadges | A |
| POST | `/bulk-insert` | bulkInsertBadges | AD |

### `/certificate` → `certificate` (1)

| GET | `/` | getCertificate | – |

Owns the Puppeteer browser pool and its `cleanup()` on SIGTERM/SIGINT.

### `/plans` → `plan` (5)

| POST | `/` | createPlan | AD |
| GET | `/` | listPlans | – |
| POST | `/attach-prices` | attachPlanPrices | AD |
| POST | `/create-direct-plan` | createDirectPlan | AD |
| POST | `/:planId/attach-price` | attachPriceToPlan | AD |

### `/price-catalogs` → `price-catalog` (1)

| POST | `/` | createPriceCatalog | AD |

### `/stripe` → `stripe` (10 + webhook)

| POST | `/prices` | createPrice | AD |
| POST | `/checkout/session` | createCheckoutOrOneClick | A |
| POST | `/subscription` | createSubscription | A |
| POST | `/subscription/confirm` | confirmSubscription | A |
| GET | `/subscription/status` | getSubscriptionStatus | A |
| GET | `/session/check` | checkSessionAndPlan | A |
| GET | `/user/subscription-status` | getUserSubscriptionStatus | A |
| POST | `/subscription/cancel` | cancelSubscription | A |
| POST | `/end-trial-pro` | completeTrialTransition | A |
| GET | `/assessment-id` | getAssessmentIdBySessionOrOrder | A |
| POST | `/stripe/webhook` | webhook | raw body, mounted before `express.json()` |

### `/stripe-elements` → `stripe-elements` (14)

| GET | `/config` | getConfig | – |
| GET | `/default-config` | getDefaultConfig | – |
| POST | `/create-subscription` | createSubscription | A |
| POST | `/activate-subscription` | activateSubscription | A |
| GET | `/subscription-status/:subscriptionId` | getSubscriptionStatus | A |
| POST | `/confirm-subscription` | confirmSubscription | A |
| POST | `/cancel-subscription` | cancelSubscription | A |
| GET | `/my-subscriptions` | getUserSubscriptions | A |
| POST | `/create-payment` | createPayment | A |
| GET | `/payment-status/:orderId` | getPaymentStatus | A |
| POST | `/confirm-payment` | confirmPayment | A |
| GET | `/my-orders` | getUserOrders | A |
| POST | `/quick-pay` | quickPay | A |
| POST | `/pay` | pay | A |

### `/klaviyo` → `klaviyo` (3)

| GET | `/profiles` | getAllProfiles | – |
| GET | `/events` | getAllEvents | – |
| GET | `/metrics` | getAllMetrics | – |

### `/helpscout` → `helpscout` (3)

| GET | `/user-signature` | getUserSignature | A |
| GET | `/profile-sidebar` | renderProfileSidebar | allowHelpScoutIframe |
| GET | `/klaviyo-profile` | getKlaviyoProfile | requireHelpScoutAppAuth |

### `/translate` → `translate` (1)

| POST | `/` | translate | – |

### `/lp` → `lp` (5)

| GET | `/assessment/:assessmentId/quick` | getQuickAssessmentById | – |
| POST | `/assessment/submit-score` | submitQuickAssessmentScoreLp | – |
| POST | `/hook/create` | createLpHook | – |
| PATCH | `/hook/update/:uuid` | updateLpHook | – |
| GET | `/hook/resume/:uuid` | resumeLpHook | – |

---

## Model ownership

| Module            | Models                                                                                                                          |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `user`            | User, AccountDeletionFeedback                                                                                                   |
| `admin`           | Admin                                                                                                                           |
| `game`            | Game, GamePlay, GameScore, DailyGameSuggestion, DailyChallenge                                                                  |
| `assessment`      | FullAssessment, QuestionAndAnswer, AssessmentScore, QuickMiniAssessment, UserQuickAssignment (registers `DailyQuickAssignment`) |
| `adhd-assessment` | AdhdAssessment, AdhdQuestionAndAnswer, AdhdAssessmentScore                                                                      |
| `ei-assessment`   | EmotionalIntelligenceAssessment, EmotionalIntelligenceQuestionAndAnswer, EmotionalIntelligenceAssessmentScore                   |
| `leaderboard`     | Leaderboard                                                                                                                     |
| `streak`          | UserDailyActivity                                                                                                               |
| `badge`           | Badge, BadgeUnlock                                                                                                              |
| `notification`    | Notification, NotificationReceipt                                                                                               |
| `push`            | PushSubscription                                                                                                                |
| `plan`            | Plan                                                                                                                            |
| `price-catalog`   | PriceCatalog                                                                                                                    |
| `stripe`          | Subscription, Order                                                                                                             |
| `klaviyo`         | KlaviyoBackup                                                                                                                   |
| `lp`              | LandingPageHook                                                                                                                 |

---

## Risk register

| Risk                             | Handling                                                                                                                                                                                                  |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Silent schema drift              | Model files are copied, then diffed field-by-field against v1 before the module is called done.                                                                                                           |
| Stripe webhook body parsing      | The webhook stays mounted before `express.json()` with `express.raw()`. A spec asserts the raw body reaches the handler.                                                                                  |
| Two overlapping Stripe stacks    | Both migrated as-is. No merging. Cleanup is a post-migration decision.                                                                                                                                    |
| `stripe_v2` excluded             | Dummy stack, not migrated, all four models dropped (`PlanV2`, `PriceV2`, `SubscriptionV2`, `PaymentV2`). `data-export` and `delete-account` lose their V2 sections by decision; recorded in `pending.md`. |
| `DailyQuickAssignment` name trap | Called out in rule 2; a spec asserts `model.collection.name`.                                                                                                                                             |
| Puppeteer in certificate         | Browser launch injected so tests never launch Chromium.                                                                                                                                                   |
| Cron double-run during cutover   | Jobs are behind a `JOBS_ENABLED` env flag, off by default in v2 until v1 is switched off.                                                                                                                 |
| v1 quirks read as bugs           | Behaviour is preserved exactly. Anything that looks wrong is recorded in `pending.md` as a question, never silently fixed.                                                                                |
