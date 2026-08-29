const express = require("express");
const cors = require("cors");
const createHttpError = require("http-errors");
const { config } = require("./config");
const { corsOptions } = require("./config/cors");
const requestLogger = require("./common/middlewares/requestLogger");
const globalErrorHandler = require("./common/middlewares/globalErrorHandler");
const { RESPONSE_STATUS } = require("./constants");
const userRouter = require("./modules/user/userRouter");
const authRouter = require("./modules/auth/authRouter");
const adminRouter = require("./modules/admin/adminRouter");
const leaderboardRouter = require("./modules/leaderboard/leaderboardRouter");
const badgeRouter = require("./modules/badge/badgeRouter");
const dashboardRouter = require("./modules/dashboard/dashboardRouter");
const gameRouter = require("./modules/game/gameRouter");
const streakRouter = require("./modules/streak/streakRouter");
const pushRouter = require("./modules/push/pushRouter");
const notificationRouter = require("./modules/notification/notificationRouter");
const adhdAssessmentRouter = require("./modules/adhd-assessment/adhdAssessmentRouter");
const eiAssessmentRouter = require("./modules/ei-assessment/emotionalIntelligenceAssessmentRouter");
const assessmentRouter = require("./modules/assessment/assessmentRouter");
const planRouter = require("./modules/plan/planRouter");
const priceCatalogRouter = require("./modules/price-catalog/priceCatalogRouter");
const stripeElementsRouter = require("./modules/stripe-elements/stripeElementsRouter");
const stripeRouter = require("./modules/stripe/stripeRouter");
const stripeWebhookRouter = require("./modules/stripe/stripeWebhookRouter");
const certificateRouter = require("./modules/certificate/certificateRouter");
const translateRouter = require("./modules/translate/translateRouter");
const lpRouter = require("./modules/lp/lpRouter");
const klaviyoRouter = require("./modules/klaviyo/klaviyoRouter");
const helpscoutRouter = require("./modules/helpscout/helpscoutRouter");

const app = express();

app.use(cors(corsOptions));
app.use(requestLogger);
app.use("/stripe/webhook", stripeWebhookRouter);
app.use(express.json());

app.get("/health", (req, res) =>
    res.json({
        status: RESPONSE_STATUS.SUCCESS,
        environment: config.NODE_ENV,
        uptime: process.uptime(),
    }),
);

app.use("/auth", authRouter);
app.use("/admin", adminRouter);
app.use("/user", userRouter);
app.use("/leaderboard", leaderboardRouter);
app.use("/badges", badgeRouter);
app.use("/dashboard", dashboardRouter);
app.use("/game", gameRouter);
app.use("/streak", streakRouter);
app.use("/push", pushRouter);
app.use("/notifications", notificationRouter);
app.use("/assessment/adhd", adhdAssessmentRouter);
app.use("/assessment/emotional-intelligence", eiAssessmentRouter);
app.use("/assessment", assessmentRouter);
app.use("/plans", planRouter);
app.use("/price-catalogs", priceCatalogRouter);
app.use("/stripe-elements", stripeElementsRouter);
app.use("/stripe", stripeRouter);
app.use("/certificate", certificateRouter);
app.use("/translate", translateRouter);
app.use("/lp", lpRouter);
app.use("/klaviyo", klaviyoRouter);
app.use("/helpscout", helpscoutRouter);

app.use((req, res, next) =>
    next(createHttpError(404, `Route ${req.originalUrl} not found`)),
);

app.use(globalErrorHandler);

module.exports = app;
