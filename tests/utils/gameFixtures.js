const Game = require("../../src/modules/game/gameModel");
const DailyChallenge = require("../../src/modules/game/dailyChallengeModel");
const QuickMiniAssessment = require("../../src/modules/assessment/quickMiniAssessmentModel");
const FullAssessment = require("../../src/modules/assessment/fullAssessmentModel");
const { getCETMidnight } = require("../../src/common/utils/time");

const createGame = async (overrides = {}) =>
    await Game.create({
        name: "Logic Puzzle",
        category: "Logic",
        url: "https://games.bazzingo.com/logic",
        ...overrides,
    });

const createQuickAssessment = async () => {
    const fullAssessment = await FullAssessment.create({
        title: "IQ Test",
        mainCategory: "iq-test",
        questions: 10,
        stripeProductId: "prod_test",
    });

    return await QuickMiniAssessment.create({
        fullAssessment: fullAssessment._id,
        questions: [],
        size: 5,
        order: 1,
    });
};

const createTodaysChallenge = async (games, overrides = {}) => {
    const date = getCETMidnight(new Date());
    const existing = await DailyChallenge.findOne({ date });
    const quickAssessmentId = existing
        ? existing.quickAssessmentId
        : (await createQuickAssessment())._id;

    return await DailyChallenge.findOneAndUpdate(
        { date },
        {
            $set: {
                games: games.map((game) => ({
                    gameId: game._id,
                    difficulty: "easy",
                })),
                quickAssessmentId,
                ...overrides,
            },
        },
        { upsert: true, new: true },
    );
};

module.exports = { createGame, createQuickAssessment, createTodaysChallenge };
