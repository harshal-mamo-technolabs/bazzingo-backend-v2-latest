const app = require("../../src/app");

const V1_ENDPOINTS = [
    "DELETE /notifications/:id",
    "GET /assessment",
    "GET /assessment/:id",
    "GET /assessment/adhd/:adhdAssessmentId",
    "GET /assessment/adhd/:adhdAssessmentId/report",
    "GET /assessment/adhd/report",
    "GET /assessment/current-mini-assessment-purchase-status",
    "GET /assessment/daily-assessment-purchase-recommendation",
    "GET /assessment/emotional-intelligence/:eiAssessmentId",
    "GET /assessment/emotional-intelligence/:eiAssessmentId/report",
    "GET /assessment/emotional-intelligence/report",
    "GET /assessment/program-score",
    "GET /assessment/program-scores-only",
    "GET /assessment/quick",
    "GET /assessment/quick/:id",
    "GET /assessment/recent-activity",
    "GET /assessment/score/:scoreId",
    "GET /assessment/statistics",
    "GET /assessment/subscription-and-assessments",
    "GET /assessment/user/full-scores",
    "GET /assessment/user/submitted-full-assessments",
    "GET /badges",
    "GET /badges/ranks-and-badges",
    "GET /certificate",
    "GET /dashboard",
    "GET /dashboard/daily-streak-status",
    "GET /dashboard/recent-activity",
    "GET /game/games",
    "GET /game/games/stats",
    "GET /game/recent",
    "GET /game/statistics",
    "GET /game/stats/unique-games",
    "GET /game/stats/weekly-scores",
    "GET /game/suggestions/daily",
    "GET /helpscout/klaviyo-profile",
    "GET /helpscout/profile-sidebar",
    "GET /helpscout/user-signature",
    "GET /klaviyo/events",
    "GET /klaviyo/metrics",
    "GET /klaviyo/profiles",
    "GET /leaderboard",
    "GET /lp/assessment/:assessmentId/quick",
    "GET /lp/hook/resume/:uuid",
    "GET /notifications",
    "GET /notifications/:id",
    "GET /notifications/my-notifications",
    "GET /plans",
    "GET /push/status",
    "GET /streak",
    "GET /stripe-elements/config",
    "GET /stripe-elements/default-config",
    "GET /stripe-elements/my-orders",
    "GET /stripe-elements/my-subscriptions",
    "GET /stripe-elements/payment-status/:orderId",
    "GET /stripe-elements/subscription-status/:subscriptionId",
    "GET /stripe/assessment-id",
    "GET /stripe/session/check",
    "GET /stripe/subscription/status",
    "GET /stripe/user/subscription-status",
    "GET /user",
    "GET /user/data-export",
    "GET /user/subscription-and-assessments",
    "PATCH /lp/hook/update/:uuid",
    "POST /admin/login",
    "POST /admin/signup",
    "POST /assessment",
    "POST /assessment/:fullAssessmentId/generate-quick",
    "POST /assessment/:fullAssessmentId/questions",
    "POST /assessment/adhd",
    "POST /assessment/adhd/:adhdAssessmentId/questions",
    "POST /assessment/adhd/submit",
    "POST /assessment/attach-price",
    "POST /assessment/emotional-intelligence",
    "POST /assessment/emotional-intelligence/:eiAssessmentId/questions",
    "POST /assessment/emotional-intelligence/submit",
    "POST /assessment/submit",
    "POST /auth/forgot-password",
    "POST /auth/forgot-password/:token",
    "POST /auth/google-login",
    "POST /auth/login",
    "POST /auth/login-msisdn",
    "POST /auth/refresh-token-lp",
    "POST /auth/reset-password",
    "POST /auth/signup",
    "POST /auth/signup-lp",
    "POST /auth/signup-msisdn",
    "POST /auth/sync-assessment-submission-lp",
    "POST /badges/bulk-insert",
    "POST /game/games",
    "POST /game/play",
    "POST /game/score",
    "POST /lp/assessment/submit-score",
    "POST /lp/hook/create",
    "POST /notifications",
    "POST /notifications/:id/acknowledge",
    "POST /notifications/debug-admin",
    "POST /notifications/minimal",
    "POST /notifications/test",
    "POST /plans",
    "POST /plans/:planId/attach-price",
    "POST /plans/attach-prices",
    "POST /plans/create-direct-plan",
    "POST /price-catalogs",
    "POST /push/subscribe",
    "POST /push/unsubscribe",
    "POST /streak",
    "POST /stripe-elements/activate-subscription",
    "POST /stripe-elements/cancel-subscription",
    "POST /stripe-elements/confirm-payment",
    "POST /stripe-elements/confirm-subscription",
    "POST /stripe-elements/create-payment",
    "POST /stripe-elements/create-subscription",
    "POST /stripe-elements/pay",
    "POST /stripe-elements/quick-pay",
    "POST /stripe/checkout/session",
    "POST /stripe/end-trial-pro",
    "POST /stripe/prices",
    "POST /stripe/subscription",
    "POST /stripe/subscription/cancel",
    "POST /stripe/subscription/confirm",
    "POST /stripe/webhook",
    "POST /translate",
    "POST /user/delete-account",
    "PUT /notifications/:id",
    "PUT /user",
    "PUT /user/preferences",
];

const collectRoutes = (stack, prefix, found) => {
    for (const layer of stack) {
        if (layer.route) {
            const path = `${prefix}${layer.route.path}`.replace(/\/$/, "");

            for (const method of Object.keys(layer.route.methods)) {
                if (method !== "head") {
                    found.add(`${method.toUpperCase()} ${path || "/"}`);
                }
            }
        } else if (layer.name === "router" && layer.handle?.stack) {
            const mount = layer.regexp
                .toString()
                .replace("/^", "")
                .replace("\\/?(?=\\/|$)/i", "")
                .replace(/\\\//g, "/");

            collectRoutes(
                layer.handle.stack,
                prefix + (mount === "(?:/)?" ? "" : mount),
                found,
            );
        }
    }
};

describe("route parity with the v1 backend", () => {
    const mounted = new Set();

    beforeAll(() => {
        collectRoutes(app._router.stack, "", mounted);
    });

    it("should mount every v1 endpoint", () => {
        const missing = V1_ENDPOINTS.filter((route) => !mounted.has(route));

        expect(missing).toEqual([]);
    });

    it("should mount all 126 v1 endpoints", () => {
        expect(V1_ENDPOINTS).toHaveLength(126);
    });

    it("should not add routes beyond the health probe", () => {
        const extras = [...mounted].filter(
            (route) => !V1_ENDPOINTS.includes(route),
        );

        expect(extras).toEqual(["GET /health"]);
    });
});
