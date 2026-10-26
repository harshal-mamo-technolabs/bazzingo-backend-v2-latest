const crypto = require("crypto");
const request = require("supertest");
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const requestLogger = require("../../src/common/middlewares/requestLogger");
const globalErrorHandler = require("../../src/common/middlewares/globalErrorHandler");
const { requireAuth } = require("../../src/common/middlewares/authenticate");
const { asyncWrapper } = require("../../src/common/utils/wrapper");
const { config } = require("../../src/config");
const logger = require("../../src/config/logger");
const { AuthController } = require("../../src/modules/auth/authController");
const { AuthService } = require("../../src/modules/auth/authService");
const { BadgeService } = require("../../src/modules/badge/badgeService");
const {
    LeaderboardService,
} = require("../../src/modules/leaderboard/leaderboardService");
const Leaderboard = require("../../src/modules/leaderboard/leaderboardModel");
const Subscription = require("../../src/modules/stripe/subscriptionModel");
const User = require("../../src/modules/user/userModel");
const LandingPageHook = require("../../src/modules/lp/landingPageHookModel");
const Badge = require("../../src/modules/badge/badgeModel");
const { badges } = require("../../src/modules/badge/badgeData");
const { useInMemoryDatabase } = require("../utils/db");
const { createUser, getAccessToken } = require("../utils/fixtures");

const stripeClient = {
    customers: { create: jest.fn(async () => ({ id: "cus_test" })) },
};
const googleVerifier = { verifyIdToken: jest.fn() };
const sendEmail = jest.fn(async () => undefined);
const helpscoutService = { scheduleSyncUserUtmToHelpScout: jest.fn() };

const buildApp = () => {
    const authService = new AuthService(logger, {
        stripeClient,
        googleVerifier,
        sendEmail,
    });

    const controller = new AuthController(
        authService,
        new LeaderboardService(logger),
        new BadgeService(logger),
        helpscoutService,
        logger,
    );

    const handler = (method) =>
        asyncWrapper(controller[method].bind(controller));

    const app = express();
    app.use(express.json());
    app.use(requestLogger);
    app.post("/auth/signup", handler("signup"));
    app.post("/auth/signup-lp", handler("signupLp"));
    app.post("/auth/signup-msisdn", handler("signupMsisdn"));
    app.post(
        "/auth/sync-assessment-submission-lp",
        handler("syncAssessmentSubmissionLp"),
    );
    app.post("/auth/refresh-token-lp", handler("refreshTokenLp"));
    app.post("/auth/login", handler("login"));
    app.post("/auth/login-msisdn", handler("loginMsisdn"));
    app.post("/auth/google-login", handler("googleLogin"));
    app.post("/auth/forgot-password", handler("forgotPassword"));
    app.post("/auth/forgot-password/:token", handler("resetPasswordWithToken"));
    app.post("/auth/reset-password", requireAuth, handler("resetPassword"));
    app.use(globalErrorHandler);
    return app;
};

const app = buildApp();

beforeEach(() => {
    jest.clearAllMocks();
    stripeClient.customers.create.mockResolvedValue({ id: "cus_test" });
    sendEmail.mockResolvedValue(undefined);
});

describe("POST /auth/signup", () => {
    useInMemoryDatabase();

    const validBody = {
        name: "Harshal",
        email: "harshal@bazzingo.com",
        password: "secret-password",
        age: 27,
        country: "India",
    };

    const signup = (body = validBody) =>
        request(app).post("/auth/signup").send(body);

    it("should return a 201 with a token", async () => {
        const response = await signup();

        expect(response.statusCode).toBe(201);
        expect(response.body.message).toBe("User registered successfully");
        expect(response.body.data.token).toBeTruthy();
    });

    it("should sign the token for the new user for a year", async () => {
        const response = await signup();

        const decoded = jwt.verify(response.body.data.token, config.JWT_SECRET);
        const user = await User.findOne({ email: validBody.email });
        expect(decoded.userId).toBe(String(user._id));
        expect(decoded.exp - decoded.iat).toBe(365 * 24 * 60 * 60);
    });

    it("should hash the password", async () => {
        await signup();

        const user = await User.findOne({ email: validBody.email });
        expect(user.password).not.toBe(validBody.password);
        expect(await bcrypt.compare(validBody.password, user.password)).toBe(
            true,
        );
    });

    it("should assign a random avatar", async () => {
        await signup();

        const user = await User.findOne({ email: validBody.email });
        expect(user.avatar).toMatch(/^\/avatar\/person[1-8]\.png$/);
    });

    it("should create a stripe customer", async () => {
        await signup();

        expect(stripeClient.customers.create).toHaveBeenCalledWith({
            name: "Harshal",
            email: validBody.email,
        });
        const user = await User.findOne({ email: validBody.email });
        expect(user.stripeCustomerId).toBe("cus_test");
    });

    it("should still sign up when stripe fails", async () => {
        stripeClient.customers.create.mockRejectedValueOnce(
            new Error("stripe is down"),
        );

        const response = await signup();

        expect(response.statusCode).toBe(201);
        const user = await User.findOne({ email: validBody.email });
        expect(user.stripeCustomerId).toBeNull();
    });

    it("should create the leaderboard row", async () => {
        await signup();

        const user = await User.findOne({ email: validBody.email });
        const row = await Leaderboard.findOne({ userId: user._id });
        expect(row.name).toBe("Harshal");
        expect(row.country).toBe("india");
    });

    it("should unlock the registration badges", async () => {
        await Badge.insertMany(badges);

        const response = await signup();

        expect(
            response.body.data.unlockedBadges.map((b) => b.badge.name).sort(),
        ).toEqual(["early-adopter", "leaderboard-rookie"]);
    });

    it("should always return an unlockedBadges array", async () => {
        const response = await signup();

        expect(Array.isArray(response.body.data.unlockedBadges)).toBe(true);
    });

    it("should return a 400 for a duplicate email", async () => {
        await signup();

        const response = await signup();

        expect(response.statusCode).toBe(400);
        expect(response.body.message).toBe(
            "User already exists with this email",
        );
    });

    it("should return a 403 for a soft deleted email", async () => {
        await createUser({ email: validBody.email, isDeleted: true });

        const response = await signup();

        expect(response.statusCode).toBe(403);
        expect(response.body.context.reason).toBe("account_deleted");
    });
});

describe("POST /auth/login", () => {
    useInMemoryDatabase();

    const credentials = {
        email: "harshal@bazzingo.com",
        password: "secret-password",
    };

    const seedUser = async (overrides = {}) =>
        await createUser({
            email: credentials.email,
            password: await bcrypt.hash(credentials.password, 10),
            ...overrides,
        });

    const login = (body = credentials) =>
        request(app).post("/auth/login").send(body);

    it("should return a 200 with a seven day token", async () => {
        const user = await seedUser();

        const response = await login();

        expect(response.statusCode).toBe(200);
        expect(response.body.message).toBe("Login successful");
        const decoded = jwt.verify(response.body.data.token, config.JWT_SECRET);
        expect(decoded.userId).toBe(String(user._id));
        expect(decoded.exp - decoded.iat).toBe(7 * 24 * 60 * 60);
    });

    it("should return a 400 when credentials are missing", async () => {
        const response = await login({ email: credentials.email });

        expect(response.statusCode).toBe(400);
        expect(response.body.message).toBe("Email and password are required");
    });

    it("should return a 400 for an unknown email", async () => {
        const response = await login();

        expect(response.statusCode).toBe(400);
        expect(response.body.message).toBe(
            "Please enter correct email or password",
        );
    });

    it("should return a 400 for a wrong password", async () => {
        await seedUser();

        const response = await login({ ...credentials, password: "wrong" });

        expect(response.statusCode).toBe(400);
        expect(response.body.message).toBe(
            "Please enter correct email or password",
        );
    });

    it("should not reveal whether the email exists", async () => {
        await seedUser();

        const unknown = await login({
            email: "nobody@bazzingo.com",
            password: "x",
        });
        const wrong = await login({ ...credentials, password: "wrong" });

        expect(unknown.body.message).toBe(wrong.body.message);
    });

    it("should return a 400 for a google-only account", async () => {
        await User.create({
            name: "Google User",
            email: credentials.email,
            googleId: "google-1",
        });

        const response = await login();

        expect(response.statusCode).toBe(400);
        expect(response.body.message).toBe(
            "This account was created with Google. Please use Google login instead.",
        );
    });

    it("should return a 403 for a soft deleted account", async () => {
        await seedUser({ isDeleted: true });

        const response = await login();

        expect(response.statusCode).toBe(403);
    });
});

describe("POST /auth/google-login", () => {
    useInMemoryDatabase();

    const payload = {
        email: "google@bazzingo.com",
        sub: "google-sub-1",
        name: "Google User",
    };

    const mockGoogle = () =>
        googleVerifier.verifyIdToken.mockResolvedValue({
            getPayload: () => payload,
        });

    const googleLogin = (body = { idToken: "id-token" }) =>
        request(app).post("/auth/google-login").send(body);

    it("should create the user on first login", async () => {
        mockGoogle();

        const response = await googleLogin();

        expect(response.statusCode).toBe(200);
        const user = await User.findOne({ email: payload.email });
        expect(user.googleId).toBe("google-sub-1");
    });

    it("should reuse the existing user on a later login", async () => {
        mockGoogle();
        await googleLogin();

        await googleLogin();

        expect(await User.countDocuments({ email: payload.email })).toBe(1);
    });

    it("should return a 400 without an id token", async () => {
        const response = await googleLogin({});

        expect(response.statusCode).toBe(400);
        expect(response.body.message).toBe("ID token is required");
    });

    it("should return a 403 for a soft deleted account", async () => {
        mockGoogle();
        await createUser({ email: payload.email, isDeleted: true });

        const response = await googleLogin();

        expect(response.statusCode).toBe(403);
    });

    it("should return a 500 when google rejects the token", async () => {
        googleVerifier.verifyIdToken.mockRejectedValueOnce(
            new Error("bad token"),
        );

        const response = await googleLogin();

        expect(response.statusCode).toBe(500);
    });
});

describe("POST /auth/signup-msisdn and /auth/login-msisdn", () => {
    useInMemoryDatabase();

    const msisdn = "919999999999";

    const signup = (body = { msisdn, name: "Harshal", age: 27 }) =>
        request(app).post("/auth/signup-msisdn").send(body);

    const login = (body = { msisdn }) =>
        request(app).post("/auth/login-msisdn").send(body);

    it("should create the user with a generated email", async () => {
        const response = await signup();

        expect(response.statusCode).toBe(201);
        expect(response.body.message).toBe(
            "User registered successfully with MSISDN",
        );
        expect(response.body.data.email).toBe(`${msisdn}@gmail.com`);
        const user = await User.findOne({ msisdn });
        expect(user.email).toBe(`${msisdn}@gmail.com`);
    });

    it("should hash the msisdn as the password", async () => {
        await signup();

        const user = await User.findOne({ msisdn });
        expect(await bcrypt.compare(msisdn, user.password)).toBe(true);
    });

    it("should create a ten year subscription", async () => {
        await signup();

        const user = await User.findOne({ msisdn });
        const subscription = await Subscription.findOne({ userId: user._id });
        expect(subscription.planDuration).toBe("yearly");
        expect(
            subscription.currentPeriodEnd.getFullYear() -
                subscription.currentPeriodStart.getFullYear(),
        ).toBe(10);
    });

    it("should return a 400 without an msisdn", async () => {
        const response = await signup({ name: "Harshal" });

        expect(response.statusCode).toBe(400);
        expect(response.body.message).toBe("MSISDN is required");
    });

    it("should return a 400 for a duplicate msisdn", async () => {
        await signup();

        const response = await signup();

        expect(response.statusCode).toBe(400);
        expect(response.body.message).toBe(
            "User already exists with this MSISDN",
        );
    });

    it("should log in with a seven day token", async () => {
        await signup();

        const response = await login();

        expect(response.statusCode).toBe(200);
        const decoded = jwt.verify(response.body.data.token, config.JWT_SECRET);
        expect(decoded.exp - decoded.iat).toBe(7 * 24 * 60 * 60);
    });

    it("should return a 400 for an unknown msisdn", async () => {
        const response = await login();

        expect(response.statusCode).toBe(400);
        expect(response.body.message).toBe("Invalid MSISDN");
    });

    it("should return a 400 when login has no msisdn", async () => {
        const response = await login({});

        expect(response.statusCode).toBe(400);
        expect(response.body.message).toBe("MSISDN is required");
    });
});

describe("POST /auth/signup-lp", () => {
    useInMemoryDatabase();

    const validBody = {
        name: "Harshal",
        email: "lp@bazzingo.com",
        age: 27,
        country: "India",
        landingPageName: "iq-lp",
    };

    const signupLp = (body = validBody) =>
        request(app).post("/auth/signup-lp").send(body);

    it("should create the user with a thirty minute token", async () => {
        const response = await signupLp();

        expect(response.statusCode).toBe(201);
        const decoded = jwt.verify(response.body.data.token, config.JWT_SECRET);
        expect(decoded.exp - decoded.iat).toBe(30 * 60);
    });

    it("should store the landing page name", async () => {
        await signupLp();

        const user = await User.findOne({ email: validBody.email });
        expect(user.landingPageName).toBe("iq-lp");
        expect(user.isAssessmentSubmited).toBe(false);
    });

    it("should default the utm fields", async () => {
        await signupLp();

        const user = await User.findOne({ email: validBody.email }).select(
            "+utmSource +utmCampaign +utmMedium",
        );
        expect(user.utmSource).toBe("organic");
    });

    it.each(["organic", "google"])(
        "should preserve saved attribution on repeat signup (%s)",
        async (source) => {
            const user = await createUser({
                email: validBody.email,
                utmSource: source,
                utmCampaign: "original",
                utmMedium: "cpc",
            });
            const response = await signupLp({
                ...validBody,
                utm_source: "Klaviyo",
                utm_campaign: "reminder",
                utm_medium: "email",
            });
            expect(response.status).toBe(201);
            expect(
                await User.collection.findOne({ _id: user._id }),
            ).toMatchObject({
                utmSource: source,
                utmCampaign: "original",
                utmMedium: "cpc",
            });
            expect(
                helpscoutService.scheduleSyncUserUtmToHelpScout,
            ).toHaveBeenCalledWith(
                expect.objectContaining({
                    utmSource: source,
                    utmCampaign: "original",
                    utmMedium: "cpc",
                }),
            );
        },
    );

    it("should use the first saved hook attribution when later signup sends different UTMs", async () => {
        await LandingPageHook.create({
            uuid: "first-visit",
            email: validBody.email,
            utmSource: "google",
            utmCampaign: "brand",
            utmMedium: "cpc",
        });
        const response = await signupLp({
            ...validBody,
            uuid: "first-visit",
            utm_source: "Klaviyo",
            utm_campaign: "reminder",
            utm_medium: "email",
        });
        expect(response.status).toBe(201);
        expect(
            await User.collection.findOne({ email: validBody.email }),
        ).toMatchObject({
            utmSource: "google",
            utmCampaign: "brand",
            utmMedium: "cpc",
        });
    });

    it("carries a hook's flow ID into the user created at signup", async () => {
        await LandingPageHook.create({
            uuid: "flow-visit",
            email: validBody.email,
            flowId: "XHLfvC",
        });
        const response = await signupLp({ ...validBody, uuid: "flow-visit" });
        expect(response.status).toBe(201);
        expect((await User.findOne({ email: validBody.email })).flowId).toBe(
            "XHLfvC",
        );
    });

    it("should take a real utm value from the body", async () => {
        await signupLp({ ...validBody, utm_source: "google" });

        const user = await User.findOne({ email: validBody.email });
        expect(user.toObject({ transform: false }).utmSource).toBe("google");
    });

    it("should update an existing user without an active subscription", async () => {
        await signupLp();

        const response = await signupLp({ ...validBody, name: "Changed" });

        expect(response.statusCode).toBe(201);
        expect(await User.countDocuments({ email: validBody.email })).toBe(1);
        const user = await User.findOne({ email: validBody.email });
        expect(user.name).toBe("Changed");
    });

    it("should return a 400 when the user has an active subscription", async () => {
        await signupLp();
        const user = await User.findOne({ email: validBody.email });
        await Subscription.create({
            userId: user._id,
            status: "active",
            stripeSubscriptionId: "sub_1",
            currentPeriodStart: new Date(),
            currentPeriodEnd: new Date(Date.now() + 86400000),
        });

        const response = await signupLp();

        expect(response.statusCode).toBe(400);
        expect(response.body.message).toBe(
            "User already exists with this email",
        );
    });

    it("should schedule the helpscout sync", async () => {
        await signupLp();

        expect(
            helpscoutService.scheduleSyncUserUtmToHelpScout,
        ).toHaveBeenCalled();
    });

    it("should still succeed when the helpscout sync throws", async () => {
        helpscoutService.scheduleSyncUserUtmToHelpScout.mockImplementationOnce(
            () => {
                throw new Error("helpscout is down");
            },
        );

        const response = await signupLp();

        expect(response.statusCode).toBe(201);
    });
});

describe("POST /auth/refresh-token-lp", () => {
    useInMemoryDatabase();

    const refresh = (body) =>
        request(app).post("/auth/refresh-token-lp").send(body);

    it("should exchange a short token for a year long one", async () => {
        const user = await createUser();
        const shortToken = jwt.sign(
            { userId: String(user._id) },
            config.JWT_SECRET,
            { expiresIn: "30m" },
        );

        const response = await refresh({ token: shortToken });

        expect(response.statusCode).toBe(200);
        const decoded = jwt.verify(response.body.data.token, config.JWT_SECRET);
        expect(decoded.exp - decoded.iat).toBe(365 * 24 * 60 * 60);
    });

    it("should return a 400 without a token", async () => {
        const response = await refresh({});

        expect(response.statusCode).toBe(400);
        expect(response.body.message).toBe("Token is required");
    });

    it("should return a 401 for an expired token", async () => {
        const user = await createUser();
        const expired = jwt.sign(
            { userId: String(user._id) },
            config.JWT_SECRET,
            { expiresIn: "-1h" },
        );

        const response = await refresh({ token: expired });

        expect(response.statusCode).toBe(401);
        expect(response.body.message).toBe("Invalid or expired token");
    });

    it("should return a 404 when the user is gone", async () => {
        const token = jwt.sign(
            { userId: String(new mongoose.Types.ObjectId()) },
            config.JWT_SECRET,
        );

        const response = await refresh({ token });

        expect(response.statusCode).toBe(404);
        expect(response.body.message).toBe("User not found");
    });
});

describe("POST /auth/sync-assessment-submission-lp", () => {
    useInMemoryDatabase();

    const sync = (body) =>
        request(app).post("/auth/sync-assessment-submission-lp").send(body);

    it("should create the stripe customer and flag the submission", async () => {
        const user = await createUser();

        const response = await sync({ token: getAccessToken(user._id) });

        expect(response.statusCode).toBe(200);
        expect(response.body.message).toBe(
            "Assessment submission synced successfully",
        );
        const updated = await User.findById(user._id);
        expect(updated.stripeCustomerId).toBe("cus_test");
        expect(updated.isAssessmentSubmited).toBe(true);
    });

    it("should never return the password", async () => {
        const user = await createUser();

        const response = await sync({ token: getAccessToken(user._id) });

        expect(response.body.data.user.password).toBeUndefined();
    });

    it("should skip stripe when the customer already exists", async () => {
        const user = await createUser({ stripeCustomerId: "cus_existing" });

        await sync({ token: getAccessToken(user._id) });

        expect(stripeClient.customers.create).not.toHaveBeenCalled();
    });

    it("should return a 400 without a token", async () => {
        const response = await sync({});

        expect(response.statusCode).toBe(400);
    });

    it("should return a 403 for a soft deleted account", async () => {
        const user = await createUser({ isDeleted: true });

        const response = await sync({ token: getAccessToken(user._id) });

        expect(response.statusCode).toBe(403);
    });
});

describe("password reset", () => {
    useInMemoryDatabase();

    const email = "harshal@bazzingo.com";
    const password = "secret-password";

    const seedUser = async (overrides = {}) =>
        await createUser({
            email,
            password: await bcrypt.hash(password, 10),
            ...overrides,
        });

    it("should send a reset email for a known address", async () => {
        await seedUser();

        const response = await request(app)
            .post("/auth/forgot-password")
            .send({ email });

        expect(response.statusCode).toBe(200);
        expect(response.body.message).toBe(
            "If the email is registered, a password reset link has been sent.",
        );
        expect(sendEmail).toHaveBeenCalledTimes(1);
    });

    it("should give the same answer for an unknown address", async () => {
        const response = await request(app)
            .post("/auth/forgot-password")
            .send({ email: "nobody@bazzingo.com" });

        expect(response.statusCode).toBe(200);
        expect(response.body.message).toBe(
            "If the email is registered, a password reset link has been sent.",
        );
        expect(sendEmail).not.toHaveBeenCalled();
    });

    it("should never email a soft deleted account", async () => {
        await seedUser({ isDeleted: true });

        const response = await request(app)
            .post("/auth/forgot-password")
            .send({ email });

        expect(response.statusCode).toBe(200);
        expect(sendEmail).not.toHaveBeenCalled();
    });

    it("should return a 400 without an email", async () => {
        const response = await request(app)
            .post("/auth/forgot-password")
            .send({});

        expect(response.statusCode).toBe(400);
        expect(response.body.message).toBe("Please provide an email");
    });

    it("should return a 500 when the mailer fails", async () => {
        await seedUser();
        sendEmail.mockRejectedValueOnce(new Error("smtp down"));

        const response = await request(app)
            .post("/auth/forgot-password")
            .send({ email });

        expect(response.statusCode).toBe(500);
    });

    it("should reset the password with a valid token", async () => {
        const user = await seedUser();
        const token = jwt.sign(
            { userId: String(user._id) },
            config.JWT_SECRET,
            { expiresIn: "5m" },
        );

        const response = await request(app)
            .post(`/auth/forgot-password/${token}`)
            .send({ password: "new-password" });

        expect(response.statusCode).toBe(200);
        expect(response.body.message).toBe("Password has been reset.");
        const updated = await User.findById(user._id);
        expect(await bcrypt.compare("new-password", updated.password)).toBe(
            true,
        );
    });

    it("should reset the password with a persistent no-expiry token and then invalidate it", async () => {
        const user = await seedUser();
        const rawToken = crypto.randomBytes(32).toString("hex");
        const tokenHash = crypto
            .createHash("sha256")
            .update(rawToken)
            .digest("hex");
        await User.findByIdAndUpdate(user._id, {
            passwordResetToken: tokenHash,
        });

        const response = await request(app)
            .post(`/auth/forgot-password/${rawToken}`)
            .send({ password: "new-password" });

        expect(response.statusCode).toBe(200);
        const updated = await User.findById(user._id);
        expect(await bcrypt.compare("new-password", updated.password)).toBe(
            true,
        );
        expect(updated.passwordResetToken).toBeNull();

        const reuse = await request(app)
            .post(`/auth/forgot-password/${rawToken}`)
            .send({ password: "another-password" });

        expect(reuse.statusCode).toBe(400);
    });

    it("should return a 400 for an expired reset token", async () => {
        const user = await seedUser();
        const token = jwt.sign(
            { userId: String(user._id) },
            config.JWT_SECRET,
            { expiresIn: "-1h" },
        );

        const response = await request(app)
            .post(`/auth/forgot-password/${token}`)
            .send({ password: "new-password" });

        expect(response.statusCode).toBe(400);
        expect(response.body.message).toBe("Token has expired.");
    });

    it("should return a 400 for a malformed reset token", async () => {
        const response = await request(app)
            .post("/auth/forgot-password/not-a-token")
            .send({ password: "new-password" });

        expect(response.statusCode).toBe(400);
        expect(response.body.message).toBe("Invalid token.");
    });

    it("should return a 400 without a new password", async () => {
        const response = await request(app)
            .post("/auth/forgot-password/whatever")
            .send({});

        expect(response.statusCode).toBe(400);
        expect(response.body.message).toBe("Password is required");
    });

    it("should change the password when authenticated", async () => {
        const user = await seedUser();

        const response = await request(app)
            .post("/auth/reset-password")
            .set("Authorization", `Bearer ${getAccessToken(user._id)}`)
            .send({ oldPassword: password, newPassword: "brand-new" });

        expect(response.statusCode).toBe(200);
        expect(response.body.message).toBe("Password updated successfully");
        const updated = await User.findById(user._id);
        expect(await bcrypt.compare("brand-new", updated.password)).toBe(true);
    });

    it("should return a 400 for a wrong old password", async () => {
        const user = await seedUser();

        const response = await request(app)
            .post("/auth/reset-password")
            .set("Authorization", `Bearer ${getAccessToken(user._id)}`)
            .send({ oldPassword: "wrong", newPassword: "brand-new" });

        expect(response.statusCode).toBe(400);
        expect(response.body.message).toBe("Old password is incorrect");
    });

    it("should return a 400 when a password is missing", async () => {
        const user = await seedUser();

        const response = await request(app)
            .post("/auth/reset-password")
            .set("Authorization", `Bearer ${getAccessToken(user._id)}`)
            .send({ oldPassword: password });

        expect(response.statusCode).toBe(400);
        expect(response.body.message).toBe(
            "Old and new passwords are required",
        );
    });

    it("should return a 401 without a token", async () => {
        const response = await request(app)
            .post("/auth/reset-password")
            .send({});

        expect(response.statusCode).toBe(401);
    });
});
