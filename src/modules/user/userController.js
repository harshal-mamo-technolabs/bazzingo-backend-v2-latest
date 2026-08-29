const createHttpError = require("http-errors");
const { sendResponse } = require("../../common/utils/response");
const {
    RESPONSE_STATUS,
    USER_MESSAGES,
    USER_UPDATABLE_FIELDS,
    USER_TEXT_FIELDS,
    USER_AGE_RANGE,
    NOTIFICATION_PREFERENCE_FIELDS,
} = require("../../constants");

class UserController {
    constructor(userService, logger) {
        this.userService = userService;
        this.logger = logger;
    }

    async getProfile(req, res, next) {
        const userId = req.user._id;

        this.logger.info("Request to read the user profile", {
            requestId: req.requestId,
            userId: String(userId),
        });

        const user = await this.userService.findById(userId);

        if (!user) {
            this.logger.warn("User profile not found", {
                requestId: req.requestId,
                userId: String(userId),
            });
            return next(createHttpError(404, USER_MESSAGES.NOT_FOUND));
        }

        this.logger.info("User profile sent", {
            requestId: req.requestId,
            userId: String(userId),
        });

        return sendResponse(res, {
            statusCode: 200,
            status: RESPONSE_STATUS.SUCCESS,
            message: USER_MESSAGES.PROFILE_FETCHED,
            data: { user },
        });
    }

    async updateProfile(req, res, next) {
        const userId = req.user._id;
        const updates = this.pickAllowedFields(req.body);

        if (Object.keys(updates).length === 0) {
            this.logger.warn("User profile update had no allowed fields", {
                requestId: req.requestId,
                userId: String(userId),
                receivedFields: Object.keys(req.body),
            });
            return next(createHttpError(400, USER_MESSAGES.NO_VALID_FIELDS));
        }

        this.logger.info("Request to update the user profile", {
            requestId: req.requestId,
            userId: String(userId),
            fields: Object.keys(updates),
        });

        const user = await this.userService.update(userId, updates);

        if (!user) {
            this.logger.warn("User to update was not found", {
                requestId: req.requestId,
                userId: String(userId),
            });
            return next(createHttpError(404, USER_MESSAGES.NOT_FOUND));
        }

        this.logger.info("User profile updated", {
            requestId: req.requestId,
            userId: String(userId),
            fields: Object.keys(updates),
        });

        return sendResponse(res, {
            statusCode: 200,
            status: RESPONSE_STATUS.SUCCESS,
            message: USER_MESSAGES.PROFILE_UPDATED,
            data: { user },
        });
    }

    async updateNotificationPreferences(req, res, next) {
        const userId = req.user._id;
        const updates = this.pickAllowedPreferences(req.body);

        if (Object.keys(updates).length === 0) {
            this.logger.warn("Preferences update had no allowed fields", {
                requestId: req.requestId,
                userId: String(userId),
                receivedSections: Object.keys(req.body),
            });
            return next(
                createHttpError(400, USER_MESSAGES.NO_VALID_PREFERENCE_FIELDS),
            );
        }

        this.logger.info("Request to update notification preferences", {
            requestId: req.requestId,
            userId: String(userId),
            fields: Object.keys(updates),
        });

        const user = await this.userService.updatePreferences(userId, updates);

        if (!user) {
            this.logger.warn("User to update preferences for was not found", {
                requestId: req.requestId,
                userId: String(userId),
            });
            return next(createHttpError(404, USER_MESSAGES.NOT_FOUND));
        }

        this.logger.info("Notification preferences updated", {
            requestId: req.requestId,
            userId: String(userId),
            fields: Object.keys(updates),
        });

        return sendResponse(res, {
            statusCode: 200,
            status: RESPONSE_STATUS.SUCCESS,
            message: USER_MESSAGES.PREFERENCES_UPDATED,
            data: { preferences: user.preferences },
        });
    }

    pickAllowedFields(body) {
        return USER_UPDATABLE_FIELDS.reduce((updates, field) => {
            if (Object.prototype.hasOwnProperty.call(body, field)) {
                updates[field] = this.cleanField(field, body[field]);
            }
            return updates;
        }, {});
    }

    cleanField(field, value) {
        if (field === "age") {
            const age = Number(value);

            if (
                !Number.isInteger(age) ||
                age < USER_AGE_RANGE.MIN ||
                age > USER_AGE_RANGE.MAX
            ) {
                throw createHttpError(400, USER_MESSAGES.INVALID_AGE);
            }

            return age;
        }

        if (USER_TEXT_FIELDS.includes(field)) {
            const text = typeof value === "string" ? value.trim() : "";

            if (text === "") {
                throw createHttpError(
                    400,
                    `${field} should be a non empty string`,
                );
            }

            return text;
        }

        return value;
    }

    pickAllowedPreferences(body) {
        const updates = {};

        for (const [section, keys] of Object.entries(
            NOTIFICATION_PREFERENCE_FIELDS,
        )) {
            const sectionValue = body[section];

            if (!sectionValue || typeof sectionValue !== "object") {
                continue;
            }

            for (const key of keys) {
                if (Object.prototype.hasOwnProperty.call(sectionValue, key)) {
                    updates[`preferences.${section}.${key}`] = Boolean(
                        sectionValue[key],
                    );
                }
            }
        }

        return updates;
    }
}

module.exports = { UserController };
