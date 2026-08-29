const { getCETMidnight } = require("../../common/utils/time");
const {
    ASSESSMENT_TYPES,
    DASHBOARD_ACTIVITY_TYPES,
    DASHBOARD_ASSESSMENT_NAMES,
    DASHBOARD_FUNNEL_SCORE_KEYS,
    DASHBOARD_LIMITS,
    DASHBOARD_SELECT_FIELDS,
} = require("../../constants");
const DailyChallenge = require("../game/dailyChallengeModel");
const GameScore = require("../game/gameScoreModel");

const toKey = (date) => date.toISOString().slice(0, 10);

const startOfLocalDay = (dateLike) => {
    const date = new Date(dateLike);

    date.setHours(0, 0, 0, 0);

    return date;
};

const getWindowStart = (today) => {
    const start = new Date(today);

    start.setMonth(start.getMonth() - DASHBOARD_LIMITS.MONTHS_BACK);
    start.setDate(1);
    start.setHours(0, 0, 0, 0);

    return start;
};

const computeStreakStats = (activeSet, start, end) => {
    let longestStreak = 0;
    let tempStreak = 0;

    for (
        let cursor = new Date(
            start.getFullYear(),
            start.getMonth(),
            start.getDate(),
        );
        cursor <= end;
        cursor.setDate(cursor.getDate() + 1)
    ) {
        if (activeSet.has(toKey(cursor))) {
            tempStreak += 1;

            if (tempStreak > longestStreak) {
                longestStreak = tempStreak;
            }
        } else {
            tempStreak = 0;
        }
    }

    let currentStreak = 0;
    let cursor = new Date(end.getFullYear(), end.getMonth(), end.getDate());

    while (cursor >= start && activeSet.has(toKey(cursor))) {
        currentStreak += 1;
        cursor.setDate(cursor.getDate() - 1);
    }

    return { currentStreak, longestStreak };
};

class DashboardService {
    constructor(
        logger,
        userService,
        gameService,
        assessmentService,
        streakService,
    ) {
        this.logger = logger;
        this.userService = userService;
        this.gameService = gameService;
        this.assessmentService = assessmentService;
        this.streakService = streakService;
    }

    async getStats(userId) {
        this.logger.info("Aggregating the dashboard stats", {
            userId: String(userId),
        });

        const user = await this.userService.findById(userId);

        if (!user) {
            this.logger.warn("Dashboard stats requested for a missing user", {
                userId: String(userId),
            });

            return null;
        }

        const [uniqueGamesPlayed, streak] = await Promise.all([
            this.countUniqueGamesPlayed(userId),
            this.buildStreak(userId),
        ]);

        this.logger.info("Dashboard stats aggregated", {
            userId: String(userId),
            uniqueGamesPlayed,
        });

        return { uniqueGamesPlayed, ...this.buildFunnelScore(user), streak };
    }

    async countUniqueGamesPlayed(userId) {
        const gameIds = await GameScore.distinct("gameId", { userId });

        return gameIds.length;
    }

    buildFunnelScore(user) {
        const funnelCategory = user.userFunnelAssessmentCategory;
        const programScore =
            user.programScore instanceof Map
                ? Object.fromEntries(user.programScore)
                : user.programScore || {};

        const entry = funnelCategory ? programScore[funnelCategory] : undefined;
        const score =
            entry && entry.programScore !== undefined ? entry.programScore : 0;

        return {
            [DASHBOARD_FUNNEL_SCORE_KEYS[funnelCategory] ?? funnelCategory]:
                score,
        };
    }

    async buildStreak(userId) {
        const today = getCETMidnight();
        const start = getWindowStart(today);

        const activities = await this.streakService.findInRange({
            userId,
            start,
            end: today,
        });

        const days = activities
            .map((activity) => ({
                date: startOfLocalDay(activity.createdAt),
                isGamePlayed: Boolean(activity.isGamePlayed),
                isAssessmentCompleted: Boolean(activity.isAssessmentCompleted),
            }))
            .filter((day) => day.isGamePlayed || day.isAssessmentCompleted);

        const activeSet = new Set(days.map((day) => toKey(day.date)));

        return {
            range: { start, end: today },
            days,
            stats: computeStreakStats(activeSet, start, today),
        };
    }

    async getRecentActivity(userId) {
        this.logger.info("Reading the recent activity", {
            userId: String(userId),
        });

        const gameScores = await GameScore.find({ userId })
            .sort({ createdAt: -1 })
            .limit(DASHBOARD_LIMITS.RECENT_GAMES)
            .populate("gameId", DASHBOARD_SELECT_FIELDS.GAME)
            .lean();

        const activities = gameScores
            .filter((gameScore) => gameScore.gameId)
            .map((gameScore) => ({
                type: DASHBOARD_ACTIVITY_TYPES.GAME,
                name: gameScore.gameId.name,
                percentage: Math.round(
                    (gameScore.score / DASHBOARD_LIMITS.GAME_MAX_SCORE) * 100,
                ),
            }));

        const [latestScore] = await this.assessmentService.findScores(
            { userId },
            { sort: { createdAt: -1 }, limit: 1 },
        );

        if (latestScore) {
            activities.push(await this.buildAssessmentActivity(latestScore));
        }

        const latestActivities = activities.slice(
            0,
            DASHBOARD_LIMITS.RECENT_ACTIVITIES,
        );

        this.logger.info("Recent activity read", {
            userId: String(userId),
            total: latestActivities.length,
        });

        return {
            activities: latestActivities,
            total: latestActivities.length,
        };
    }

    async buildAssessmentActivity(score) {
        let name = DASHBOARD_ASSESSMENT_NAMES.UNKNOWN;
        let maxPossibleScore = 0;

        if (score.type === ASSESSMENT_TYPES.FULL) {
            const fullAssessment =
                await this.assessmentService.findFullAssessmentById(
                    score.assessmentId,
                    DASHBOARD_SELECT_FIELDS.FULL_ASSESSMENT,
                );

            if (fullAssessment) {
                name =
                    fullAssessment.title ||
                    `${fullAssessment.mainCategory}${DASHBOARD_ASSESSMENT_NAMES.CATEGORY_SUFFIX}`;
                maxPossibleScore =
                    fullAssessment.questions * fullAssessment.fixedPoint;
            }
        } else if (score.type === ASSESSMENT_TYPES.QUICK) {
            const quickMini = await this.assessmentService.findQuickMiniById(
                score.assessmentId,
                DASHBOARD_SELECT_FIELDS.QUICK_ASSESSMENT,
            );

            if (quickMini) {
                maxPossibleScore =
                    quickMini.questions.length *
                    DASHBOARD_LIMITS.QUICK_QUESTION_POINTS;
                name = DASHBOARD_ASSESSMENT_NAMES.QUICK;
            }
        }

        return {
            type: DASHBOARD_ACTIVITY_TYPES.ASSESSMENT,
            name,
            score: score.totalScore,
            outOfScore: maxPossibleScore,
            percentage:
                maxPossibleScore > 0
                    ? Math.round((score.totalScore / maxPossibleScore) * 100)
                    : 0,
        };
    }

    async getDailyStreakStatus(userId) {
        this.logger.info("Reading the daily streak status", {
            userId: String(userId),
        });

        const latestChallenge = await DailyChallenge.findOne({})
            .sort({ date: -1 })
            .lean();

        if (!latestChallenge) {
            this.logger.warn("No daily challenge exists yet", {
                userId: String(userId),
            });

            return {
                dailySuggestedGame: null,
                dailySuggestedAssessment: null,
            };
        }

        const suggestionDate = getCETMidnight(latestChallenge.date);
        const suggestedGameIds = latestChallenge.games.map(
            (game) => game.gameId,
        );

        const [playedGameIds, submittedQuick, submittedFull] =
            await Promise.all([
                this.gameService.playedSuggestionIds({
                    userId,
                    gameIds: suggestedGameIds,
                    suggestedDate: suggestionDate,
                }),
                this.assessmentService.findScore({
                    userId,
                    type: ASSESSMENT_TYPES.QUICK,
                    assessmentId: latestChallenge.quickAssessmentId,
                    date: suggestionDate,
                }),
                this.assessmentService.findScores({
                    userId,
                    type: ASSESSMENT_TYPES.FULL,
                    date: getCETMidnight(new Date()),
                }),
            ]);

        const submittedQuickCount = submittedQuick ? 1 : 0;

        this.logger.info("Daily streak status read", {
            userId: String(userId),
            submittedGames: playedGameIds.size,
            submittedQuickCount,
        });

        return {
            dailySuggestedGame: {
                totalSuggestedGames: suggestedGameIds.length,
                totalSubmitedGames: playedGameIds.size,
            },
            dailySuggestedAssessment: {
                totalSuggestedAssessments: 1,
                totalSubmitedAssessments: submittedQuickCount,
                breakdown: {
                    quickAssessment: {
                        suggested: 1,
                        submitted: submittedQuickCount,
                        assessmentId: latestChallenge.quickAssessmentId,
                    },
                    fullAssessments: {
                        suggested: 0,
                        submitted: submittedFull.length,
                        assessmentIds: submittedFull.map(
                            (score) => score.assessmentId,
                        ),
                    },
                },
            },
        };
    }
}

module.exports = { DashboardService };
