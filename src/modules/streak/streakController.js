const createHttpError = require("http-errors");
const { sendResponse } = require("../../common/utils/response");
const { RESPONSE_STATUS, STREAK_MESSAGES } = require("../../constants");

const startOfDay = (dateLike) => {
    const date = dateLike ? new Date(dateLike) : new Date();
    date.setHours(0, 0, 0, 0);
    return date;
};

const endOfDay = (dateLike) => {
    const date = dateLike ? new Date(dateLike) : new Date();
    date.setHours(23, 59, 59, 999);
    return date;
};

const toKey = (date) => date.toISOString().slice(0, 10);

class StreakController {
    constructor(streakService, logger) {
        this.streakService = streakService;
        this.logger = logger;
    }

    async upsertDailyActivity(req, res, next) {
        const { isGamePlayed, isAssessmentCompleted } = req.body;
        const userId = req.user._id;

        this.logger.info("Request to save the daily activity", {
            requestId: req.requestId,
            userId: String(userId),
        });

        const update = {};

        if (typeof isGamePlayed === "boolean") {
            update.isGamePlayed = isGamePlayed;
        }

        if (typeof isAssessmentCompleted === "boolean") {
            update.isAssessmentCompleted = isAssessmentCompleted;
        }

        if (Object.keys(update).length === 0) {
            this.logger.warn("Daily activity had no usable flag", {
                requestId: req.requestId,
                userId: String(userId),
                received: Object.keys(req.body),
            });
            return next(createHttpError(400, STREAK_MESSAGES.FLAG_REQUIRED));
        }

        const userDailyActivity = await this.streakService.upsertForUser({
            userId,
            update,
        });

        this.logger.info("Daily activity saved", {
            requestId: req.requestId,
            userId: String(userId),
            activityId: String(userDailyActivity._id),
        });

        return sendResponse(res, {
            statusCode: 200,
            status: RESPONSE_STATUS.SUCCESS,
            message: STREAK_MESSAGES.SAVED,
            data: { userDailyActivity },
        });
    }

    async getStreakData(req, res) {
        const userId = req.user._id;
        const { startDate, endDate } = req.query;

        this.logger.info("Request to read the streak data", {
            requestId: req.requestId,
            userId: String(userId),
            startDate,
            endDate,
        });

        const range = this.resolveRange({ startDate, endDate });

        if (range.error) {
            this.logger.warn("Streak range was rejected", {
                requestId: req.requestId,
                userId: String(userId),
                reason: range.error,
            });

            return sendResponse(res, {
                statusCode: 400,
                status: RESPONSE_STATUS.FAIL,
                message: range.error,
                data: null,
            });
        }

        const activities = await this.streakService.findInRange({
            userId,
            start: range.start,
            end: range.end,
        });

        const days = activities
            .map((activity) => ({
                date: startOfDay(activity.createdAt),
                isGamePlayed: Boolean(activity.isGamePlayed),
                isAssessmentCompleted: Boolean(activity.isAssessmentCompleted),
            }))
            .filter((day) => day.isGamePlayed || day.isAssessmentCompleted);

        const stats = this.computeStreaks({ days, range });

        this.logger.info("Streak data sent", {
            requestId: req.requestId,
            userId: String(userId),
            activeDays: days.length,
            ...stats,
        });

        return sendResponse(res, {
            statusCode: 200,
            status: RESPONSE_STATUS.SUCCESS,
            message: STREAK_MESSAGES.STREAK_DATA,
            data: {
                range: { start: range.start, end: range.end },
                days,
                stats,
            },
        });
    }

    resolveRange({ startDate, endDate }) {
        const today = startOfDay(new Date());

        if (!startDate && !endDate) {
            const start = new Date(today);
            start.setDate(1);
            start.setMonth(start.getMonth() - 2);
            start.setHours(0, 0, 0, 0);

            return { start, end: endOfDay(today) };
        }

        if (!startDate || !endDate) {
            return { error: STREAK_MESSAGES.RANGE_INCOMPLETE };
        }

        const startInput = new Date(startDate);
        const endInput = new Date(endDate);

        if (
            Number.isNaN(startInput.getTime()) ||
            Number.isNaN(endInput.getTime())
        ) {
            return { error: STREAK_MESSAGES.RANGE_INVALID };
        }

        const start = startOfDay(startInput);
        const end = endOfDay(endInput);

        return start > end
            ? { start: startOfDay(end), end: endOfDay(start) }
            : { start, end };
    }

    computeStreaks({ days, range }) {
        const activeSet = new Set(days.map((day) => toKey(day.date)));

        let longestStreak = 0;
        let tempStreak = 0;

        for (
            let cursor = new Date(
                range.start.getFullYear(),
                range.start.getMonth(),
                range.start.getDate(),
            );
            cursor <= range.end;
            cursor.setDate(cursor.getDate() + 1)
        ) {
            if (activeSet.has(toKey(cursor))) {
                tempStreak += 1;
                longestStreak = Math.max(longestStreak, tempStreak);
            } else {
                tempStreak = 0;
            }
        }

        let currentStreak = 0;
        const cursor = new Date(
            range.end.getFullYear(),
            range.end.getMonth(),
            range.end.getDate(),
        );

        while (cursor >= range.start && activeSet.has(toKey(cursor))) {
            currentStreak += 1;
            cursor.setDate(cursor.getDate() - 1);
        }

        return { currentStreak, longestStreak };
    }
}

module.exports = { StreakController };
