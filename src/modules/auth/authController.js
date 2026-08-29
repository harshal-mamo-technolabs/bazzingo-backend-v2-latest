const crypto = require("crypto");
const createHttpError = require("http-errors");
const { config } = require("../../config");
const { sendResponse } = require("../../common/utils/response");
const {
    parseUtmParams,
    ensureUtmDefaults,
    realUtmValue,
    UTM_DEFAULT,
} = require("../../common/utils/utmParams");
const {
    RESPONSE_STATUS,
    ACCOUNT_DELETED_REASON,
    AUTH_MESSAGES,
    AUTH_TOKEN_EXPIRY,
    AUTH_ENDPOINT_MESSAGES,
    AUTH_MESSAGE_BUILDERS,
    SUBSCRIPTION_ACTIVE_STATUSES,
} = require("../../constants");
const LandingPageHook = require("../lp/landingPageHookModel");
const Subscription = require("../stripe/subscriptionModel");

const assertAccountNotDeleted = (user) => {
    if (user && user.isDeleted) {
        throw createHttpError(403, AUTH_MESSAGES.ACCOUNT_DELETED, {
            context: { reason: ACCOUNT_DELETED_REASON },
        });
    }
};

class AuthController {
    constructor(
        authService,
        leaderboardService,
        badgeService,
        helpscoutService,
        logger,
    ) {
        this.authService = authService;
        this.leaderboardService = leaderboardService;
        this.badgeService = badgeService;
        this.helpscoutService = helpscoutService;
        this.logger = logger;
    }

    async signup(req, res, next) {
        const { name, email, password, age, country } = req.body;

        this.logger.info("Request to sign up", {
            requestId: req.requestId,
            email,
        });

        const existingUser = await this.authService.findByEmail(email);

        if (existingUser) {
            assertAccountNotDeleted(existingUser);
            return next(
                createHttpError(400, AUTH_ENDPOINT_MESSAGES.EMAIL_TAKEN),
            );
        }

        const avatar = this.authService.randomAvatar();
        const stripeCustomerId = await this.authService.createStripeCustomer({
            name,
            email,
        });

        const user = await this.authService.createUser({
            name,
            email,
            age,
            country,
            password: await this.authService.hashPassword(password),
            avatar,
            stripeCustomerId,
        });

        await this.leaderboardService.syncProfile({
            userId: user._id,
            age,
            country,
            avatar,
            name,
        });

        await this.authService.createDummySubscription(user._id);

        const unlockedBadges = await this.authService.unlockRegistrationBadges(
            this.badgeService,
            user._id,
        );

        this.logger.info("User signed up", {
            requestId: req.requestId,
            userId: String(user._id),
            unlockedBadges: unlockedBadges.length,
        });

        return sendResponse(res, {
            statusCode: 201,
            status: RESPONSE_STATUS.SUCCESS,
            message: AUTH_ENDPOINT_MESSAGES.REGISTERED,
            data: {
                token: this.authService.issueToken(
                    user._id,
                    AUTH_TOKEN_EXPIRY.SIGNUP,
                ),
                unlockedBadges,
            },
        });
    }

    async signupLp(req, res, next) {
        const {
            name,
            email,
            age,
            country,
            landingPageName,
            quickMiniAssessmntId,
            uuid,
        } = req.body;

        this.logger.info("Request to sign up from a landing page", {
            requestId: req.requestId,
            email,
            uuid,
        });

        const providedUtm = parseUtmParams(req.body, { onlyProvided: true });

        const hookUtm = await this.resolveHookUtm({
            providedUtm,
            email,
            uuid,
            requestId: req.requestId,
        });

        let user = await this.authService.findByEmail(email);

        const resolveUtm = (field) =>
            realUtmValue(providedUtm[field]) ??
            realUtmValue(hookUtm[field]) ??
            (user ? realUtmValue(user[field]) : null) ??
            UTM_DEFAULT;

        const utmSource = resolveUtm("utmSource");
        const utmCampaign = resolveUtm("utmCampaign");
        const utmMedium = resolveUtm("utmMedium");

        // Unlike the three fields above, utmEmail has no "default" fallback —
        // it should stay unset for organic traffic rather than be forced to a value.
        const utmEmail =
            realUtmValue(hookUtm.utmEmail) ??
            (user ? realUtmValue(user.utmEmail) : null);

        if (user) {
            assertAccountNotDeleted(user);

            const activeSubscription = await Subscription.findOne({
                userId: user._id,
                status: { $in: SUBSCRIPTION_ACTIVE_STATUSES },
            });

            if (activeSubscription) {
                return next(
                    createHttpError(400, AUTH_ENDPOINT_MESSAGES.EMAIL_TAKEN),
                );
            }

            if (name) user.name = name;
            if (age) user.age = age;
            if (country) user.country = country;
            if (landingPageName) user.landingPageName = landingPageName;
            if (quickMiniAssessmntId) {
                user.quickMiniAssessmntId = quickMiniAssessmntId;
            }

            user.utmSource = utmSource;
            user.utmCampaign = utmCampaign;
            user.utmMedium = utmMedium;
            if (utmEmail) user.utmEmail = utmEmail;
            ensureUtmDefaults(user);

            await user.save();
        } else {
            const randomPassword = crypto.randomBytes(32).toString("hex");

            user = await this.authService.createUser({
                name,
                email,
                age,
                country,
                password: await this.authService.hashPassword(randomPassword),
                avatar: this.authService.randomAvatar(),
                stripeCustomerId: null,
                landingPageName,
                quickMiniAssessmntId,
                isAssessmentSubmited: false,
                utmSource,
                utmCampaign,
                utmMedium,
                ...(utmEmail ? { utmEmail } : {}),
            });
        }

        this.scheduleHelpScoutSync(user, req.requestId);

        this.logger.info("Landing page signup finished", {
            requestId: req.requestId,
            userId: String(user._id),
            utmSource,
        });

        return sendResponse(res, {
            statusCode: 201,
            status: RESPONSE_STATUS.SUCCESS,
            message: AUTH_ENDPOINT_MESSAGES.REGISTERED,
            data: {
                token: this.authService.issueToken(
                    user._id,
                    AUTH_TOKEN_EXPIRY.LANDING_PAGE,
                ),
            },
        });
    }

    async resolveHookUtm({ providedUtm, email, uuid, requestId }) {
        const needsLookup =
            realUtmValue(providedUtm.utmSource) === null ||
            realUtmValue(providedUtm.utmCampaign) === null ||
            realUtmValue(providedUtm.utmMedium) === null;

        if (!needsLookup) {
            return {};
        }

        try {
            const emailKey = email ? String(email).toLowerCase() : null;

            let hook = uuid
                ? await LandingPageHook.findOne({ uuid }).lean()
                : null;

            if (!hook && emailKey) {
                hook = await LandingPageHook.findOne({ email: emailKey })
                    .sort({ updatedAt: -1 })
                    .lean();
            }

            if (!hook) {
                return {};
            }

            this.logger.info("Landing page hook matched for utm", {
                requestId,
                hookUuid: hook.uuid,
            });

            return {
                utmSource: hook.utmSource,
                utmCampaign: hook.utmCampaign,
                utmMedium: hook.utmMedium,
                utmEmail: hook.utmEmail,
            };
        } catch (err) {
            this.logger.error("Landing page hook utm lookup failed", {
                requestId,
                message: err.message,
            });

            return {};
        }
    }

    scheduleHelpScoutSync(user, requestId) {
        try {
            this.helpscoutService.scheduleSyncUserUtmToHelpScout(user);
        } catch (err) {
            this.logger.error("HelpScout utm sync scheduling failed", {
                requestId,
                userId: String(user._id),
                message: err.message,
            });
        }
    }

    async signupMsisdn(req, res, next) {
        const { msisdn, name, age, country } = req.body;

        this.logger.info("Request to sign up with an msisdn", {
            requestId: req.requestId,
            msisdn,
        });

        if (!msisdn) {
            return next(
                createHttpError(400, AUTH_ENDPOINT_MESSAGES.MSISDN_REQUIRED),
            );
        }

        const existingByMsisdn = await this.authService.findByMsisdn(msisdn);

        if (existingByMsisdn) {
            assertAccountNotDeleted(existingByMsisdn);
            return next(
                createHttpError(400, AUTH_ENDPOINT_MESSAGES.MSISDN_TAKEN),
            );
        }

        const generatedEmail = `${msisdn}@gmail.com`;
        const existingByEmail =
            await this.authService.findByEmail(generatedEmail);

        if (existingByEmail) {
            assertAccountNotDeleted(existingByEmail);
            return next(
                createHttpError(400, AUTH_ENDPOINT_MESSAGES.MSISDN_TAKEN),
            );
        }

        const avatar = this.authService.randomAvatar();

        const user = await this.authService.createUser({
            name,
            email: generatedEmail,
            age,
            country,
            password: await this.authService.hashPassword(msisdn),
            avatar,
            stripeCustomerId: null,
            msisdn,
        });

        await this.leaderboardService.syncProfile({
            userId: user._id,
            age,
            country,
            avatar,
            name,
        });

        await this.authService.createTenYearSubscription(user._id);

        const unlockedBadges = await this.authService.unlockRegistrationBadges(
            this.badgeService,
            user._id,
        );

        this.logger.info("Msisdn user signed up", {
            requestId: req.requestId,
            userId: String(user._id),
        });

        return sendResponse(res, {
            statusCode: 201,
            status: RESPONSE_STATUS.SUCCESS,
            message: AUTH_ENDPOINT_MESSAGES.REGISTERED_MSISDN,
            data: {
                token: this.authService.issueToken(
                    user._id,
                    AUTH_TOKEN_EXPIRY.SIGNUP,
                ),
                email: generatedEmail,
                unlockedBadges,
            },
        });
    }

    async loginMsisdn(req, res, next) {
        const { msisdn } = req.body;

        this.logger.info("Request to log in with an msisdn", {
            requestId: req.requestId,
            msisdn,
        });

        if (!msisdn) {
            return next(
                createHttpError(400, AUTH_ENDPOINT_MESSAGES.MSISDN_REQUIRED),
            );
        }

        const user = await this.authService.findByMsisdn(msisdn);

        if (!user) {
            return next(
                createHttpError(400, AUTH_ENDPOINT_MESSAGES.MSISDN_INVALID),
            );
        }

        assertAccountNotDeleted(user);

        this.logger.info("Msisdn login succeeded", {
            requestId: req.requestId,
            userId: String(user._id),
        });

        return sendResponse(res, {
            statusCode: 200,
            status: RESPONSE_STATUS.SUCCESS,
            message: AUTH_ENDPOINT_MESSAGES.LOGIN_SUCCESS,
            data: {
                token: this.authService.issueToken(
                    user._id,
                    AUTH_TOKEN_EXPIRY.LOGIN,
                ),
            },
        });
    }

    async syncAssessmentSubmissionLp(req, res, next) {
        const { token } = req.body;

        this.logger.info("Request to sync a landing page submission", {
            requestId: req.requestId,
        });

        if (!token) {
            return next(
                createHttpError(400, AUTH_ENDPOINT_MESSAGES.TOKEN_REQUIRED),
            );
        }

        let decoded;

        try {
            decoded = this.authService.verifyToken(token);
        } catch (err) {
            this.logger.warn("Landing page sync token rejected", {
                requestId: req.requestId,
                reason: err.message,
            });
            return next(
                createHttpError(401, AUTH_ENDPOINT_MESSAGES.TOKEN_INVALID),
            );
        }

        const user = await this.authService.findById(decoded.userId);

        if (!user) {
            return next(
                createHttpError(404, AUTH_ENDPOINT_MESSAGES.USER_NOT_FOUND),
            );
        }

        assertAccountNotDeleted(user);

        if (!user.stripeCustomerId) {
            const stripeCustomerId =
                await this.authService.createStripeCustomer({
                    name: user.name,
                    email: user.email,
                });

            if (stripeCustomerId) {
                user.stripeCustomerId = stripeCustomerId;
                user.isAssessmentSubmited = true;
                await user.save();
            }
        }

        this.logger.info("Landing page submission synced", {
            requestId: req.requestId,
            userId: String(user._id),
        });

        return sendResponse(res, {
            statusCode: 200,
            status: RESPONSE_STATUS.SUCCESS,
            message: AUTH_ENDPOINT_MESSAGES.ASSESSMENT_SYNCED,
            data: { user: user.toObject() },
        });
    }

    async refreshTokenLp(req, res, next) {
        const { token } = req.body;

        this.logger.info("Request to refresh a landing page token", {
            requestId: req.requestId,
        });

        if (!token) {
            return next(
                createHttpError(400, AUTH_ENDPOINT_MESSAGES.TOKEN_REQUIRED),
            );
        }

        let decoded;

        try {
            decoded = this.authService.verifyToken(token);
        } catch (err) {
            this.logger.warn("Landing page refresh token rejected", {
                requestId: req.requestId,
                reason: err.message,
            });
            return next(
                createHttpError(401, AUTH_ENDPOINT_MESSAGES.TOKEN_INVALID),
            );
        }

        const user = await this.authService.findById(decoded.userId);

        if (!user) {
            return next(
                createHttpError(404, AUTH_ENDPOINT_MESSAGES.USER_NOT_FOUND),
            );
        }

        this.logger.info("Landing page token refreshed", {
            requestId: req.requestId,
            userId: String(user._id),
        });

        return sendResponse(res, {
            statusCode: 200,
            status: RESPONSE_STATUS.SUCCESS,
            message: AUTH_ENDPOINT_MESSAGES.LOGIN_SUCCESS,
            data: {
                token: this.authService.issueToken(
                    user._id,
                    AUTH_TOKEN_EXPIRY.REFRESHED,
                ),
            },
        });
    }

    async login(req, res, next) {
        const { email, password } = req.body;

        this.logger.info("Request to log in", {
            requestId: req.requestId,
            email,
        });

        if (!email || !password) {
            return next(
                createHttpError(
                    400,
                    AUTH_ENDPOINT_MESSAGES.CREDENTIALS_REQUIRED,
                ),
            );
        }

        const user = await this.authService.findByEmail(email);

        if (!user) {
            this.logger.warn("Login hit an unknown email", {
                requestId: req.requestId,
                email,
            });
            return next(
                createHttpError(
                    400,
                    AUTH_ENDPOINT_MESSAGES.CREDENTIALS_INVALID,
                ),
            );
        }

        assertAccountNotDeleted(user);

        if (!user.password) {
            return next(
                createHttpError(400, AUTH_ENDPOINT_MESSAGES.GOOGLE_ACCOUNT),
            );
        }

        const isMatch = await this.authService.comparePassword(
            password,
            user.password,
        );

        if (!isMatch) {
            this.logger.warn("Login hit a wrong password", {
                requestId: req.requestId,
                userId: String(user._id),
            });
            return next(
                createHttpError(
                    400,
                    AUTH_ENDPOINT_MESSAGES.CREDENTIALS_INVALID,
                ),
            );
        }

        this.logger.info("Login succeeded", {
            requestId: req.requestId,
            userId: String(user._id),
        });

        return sendResponse(res, {
            statusCode: 200,
            status: RESPONSE_STATUS.SUCCESS,
            message: AUTH_ENDPOINT_MESSAGES.LOGIN_SUCCESS,
            data: {
                token: this.authService.issueToken(
                    user._id,
                    AUTH_TOKEN_EXPIRY.LOGIN,
                ),
            },
        });
    }

    async googleLogin(req, res, next) {
        const { idToken } = req.body;

        this.logger.info("Request to log in with google", {
            requestId: req.requestId,
        });

        if (!idToken) {
            return next(
                createHttpError(400, AUTH_ENDPOINT_MESSAGES.ID_TOKEN_REQUIRED),
            );
        }

        const payload = await this.authService.verifyGoogleIdToken(idToken);
        const { email, sub: googleId, name } = payload;

        let user = await this.authService.findByEmail(email);

        assertAccountNotDeleted(user);

        if (!user) {
            user = await this.authService.createUser({
                email,
                googleId,
                name,
            });

            await this.authService.createDummySubscription(user._id);

            this.logger.info("Google user created", {
                requestId: req.requestId,
                userId: String(user._id),
            });
        }

        this.logger.info("Google login succeeded", {
            requestId: req.requestId,
            userId: String(user._id),
        });

        return sendResponse(res, {
            statusCode: 200,
            status: RESPONSE_STATUS.SUCCESS,
            message: AUTH_ENDPOINT_MESSAGES.LOGIN_SUCCESS,
            data: {
                token: this.authService.issueToken(
                    user._id,
                    AUTH_TOKEN_EXPIRY.LOGIN,
                ),
            },
        });
    }

    async forgotPassword(req, res, next) {
        const { email } = req.body;

        this.logger.info("Request to start a password reset", {
            requestId: req.requestId,
            email,
        });

        if (!email) {
            return next(
                createHttpError(400, AUTH_ENDPOINT_MESSAGES.EMAIL_REQUIRED),
            );
        }

        const user = await this.authService.findByEmail(email);

        if (!user || user.isDeleted) {
            this.logger.info("Password reset requested for an unknown email", {
                requestId: req.requestId,
                email,
            });

            return sendResponse(res, {
                statusCode: 200,
                status: RESPONSE_STATUS.SUCCESS,
                message: AUTH_ENDPOINT_MESSAGES.PASSWORD_RESET_SENT,
            });
        }

        const resetToken = this.authService.issueToken(
            user._id,
            AUTH_TOKEN_EXPIRY.PASSWORD_RESET,
        );
        const resetURL = `${config.FRONTEND_URL}/forgot-password/${resetToken}`;

        try {
            await this.authService.sendEmail({
                email: user.email,
                subject: AUTH_MESSAGE_BUILDERS.passwordResetSubject(
                    config.PLATFORM_NAME,
                ),
                message: AUTH_MESSAGE_BUILDERS.passwordResetText(resetURL),
                html: AUTH_MESSAGE_BUILDERS.passwordResetHtml(
                    resetURL,
                    config.PLATFORM_NAME,
                ),
            });

            this.logger.info("Password reset email sent", {
                requestId: req.requestId,
                userId: String(user._id),
            });

            return sendResponse(res, {
                statusCode: 200,
                status: RESPONSE_STATUS.SUCCESS,
                message: AUTH_ENDPOINT_MESSAGES.PASSWORD_RESET_SENT,
            });
        } catch (err) {
            this.logger.error("Password reset email failed", {
                requestId: req.requestId,
                userId: String(user._id),
                message: err.message,
            });

            return next(
                createHttpError(500, AUTH_ENDPOINT_MESSAGES.EMAIL_SEND_FAILED),
            );
        }
    }

    async resetPasswordWithToken(req, res, next) {
        const { token } = req.params;
        const { password } = req.body;

        this.logger.info("Request to reset a password with a token", {
            requestId: req.requestId,
        });

        if (!password) {
            return next(
                createHttpError(400, AUTH_ENDPOINT_MESSAGES.PASSWORD_REQUIRED),
            );
        }

        let user = await this.authService.findByResetToken(token);

        if (!user) {
            let decoded;

            try {
                decoded = this.authService.verifyToken(token);
            } catch (err) {
                this.logger.warn("Password reset token rejected", {
                    requestId: req.requestId,
                    reason: err.message,
                });

                return next(
                    createHttpError(
                        400,
                        err.name === "TokenExpiredError"
                            ? AUTH_ENDPOINT_MESSAGES.RESET_TOKEN_EXPIRED
                            : AUTH_ENDPOINT_MESSAGES.RESET_TOKEN_BAD,
                    ),
                );
            }

            user = await this.authService.findById(decoded.userId);
        }

        if (!user || user.isDeleted) {
            return next(
                createHttpError(
                    400,
                    AUTH_ENDPOINT_MESSAGES.RESET_TOKEN_INVALID,
                ),
            );
        }

        user.password = await this.authService.hashPassword(password);
        user.passwordResetToken = null;
        await user.save();

        this.logger.info("Password reset", {
            requestId: req.requestId,
            userId: String(user._id),
        });

        return sendResponse(res, {
            statusCode: 200,
            status: RESPONSE_STATUS.SUCCESS,
            message: AUTH_ENDPOINT_MESSAGES.PASSWORD_RESET,
        });
    }

    async resetPassword(req, res, next) {
        const { oldPassword, newPassword } = req.body;
        const user = req.user;

        this.logger.info("Request to change a password", {
            requestId: req.requestId,
            userId: String(user._id),
        });

        if (!oldPassword || !newPassword) {
            return next(
                createHttpError(400, AUTH_ENDPOINT_MESSAGES.PASSWORDS_REQUIRED),
            );
        }

        const isMatch = await this.authService.comparePassword(
            oldPassword,
            user.password,
        );

        if (!isMatch) {
            this.logger.warn("Password change hit a wrong old password", {
                requestId: req.requestId,
                userId: String(user._id),
            });
            return next(
                createHttpError(
                    400,
                    AUTH_ENDPOINT_MESSAGES.OLD_PASSWORD_INVALID,
                ),
            );
        }

        user.password = await this.authService.hashPassword(newPassword);
        user.passwordResetToken = null;
        await user.save();

        this.logger.info("Password changed", {
            requestId: req.requestId,
            userId: String(user._id),
        });

        return sendResponse(res, {
            statusCode: 200,
            status: RESPONSE_STATUS.SUCCESS,
            message: AUTH_ENDPOINT_MESSAGES.PASSWORD_UPDATED,
        });
    }
}

module.exports = { AuthController };
