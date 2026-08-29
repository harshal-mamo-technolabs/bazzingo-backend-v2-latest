const { getCETMidnight } = require("../common/utils/time");
const {
    DAILY_CHALLENGE_DIFFICULTIES,
    DAILY_CHALLENGE_GAME_COUNT,
} = require("../constants");
const QuickMiniAssessment = require("../modules/assessment/quickMiniAssessmentModel");
const DailyChallenge = require("../modules/game/dailyChallengeModel");
const Game = require("../modules/game/gameModel");

const assignDailyChallenge = async (logger) => {
    const date = getCETMidnight(new Date());
    const existing = await DailyChallenge.findOne({ date }).lean();

    if (existing) {
        logger.info("Daily challenge already exists", {
            date: date.toISOString(),
        });

        return existing;
    }

    const [games, minis] = await Promise.all([
        Game.find({ isActive: true }).select("_id").sort({ _id: 1 }).lean(),
        QuickMiniAssessment.find({ isActive: true })
            .select("_id")
            .sort({ order: 1 })
            .lean(),
    ]);

    if (games.length === 0 || minis.length === 0) {
        logger.warn("Daily challenge skipped", {
            date: date.toISOString(),
            activeGames: games.length,
            activeQuickAssessments: minis.length,
        });

        return null;
    }

    const dayCount = await DailyChallenge.countDocuments({});

    const chosenGames = Array.from(
        { length: DAILY_CHALLENGE_GAME_COUNT },
        (unused, index) => ({
            gameId: games[
                (dayCount * DAILY_CHALLENGE_GAME_COUNT + index) % games.length
            ]._id,
            difficulty:
                DAILY_CHALLENGE_DIFFICULTIES[
                    index % DAILY_CHALLENGE_DIFFICULTIES.length
                ],
        }),
    );

    const chosenMini = minis[dayCount % minis.length];

    await DailyChallenge.updateOne(
        { date },
        {
            $set: {
                date,
                games: chosenGames,
                quickAssessmentId: chosenMini._id,
                cycleNumber: Math.floor(dayCount / minis.length) + 1,
            },
        },
        { upsert: true },
    );

    logger.info("Daily challenge created", { date: date.toISOString() });

    return await DailyChallenge.findOne({ date }).lean();
};

const runDailyChallengeJob = async (logger) => {
    try {
        return await assignDailyChallenge(logger);
    } catch (err) {
        logger.error("Daily challenge job failed", {
            message: err.message,
            stack: err.stack,
        });

        return null;
    }
};

module.exports = { assignDailyChallenge, runDailyChallengeJob };
