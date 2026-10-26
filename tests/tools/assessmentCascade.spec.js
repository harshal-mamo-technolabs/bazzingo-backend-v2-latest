const mongoose = require("mongoose");
const { remove } = require("../../tools/assessment-browser");
const { getCETMidnight } = require("../../src/common/utils/time");
const FullAssessment = require("../../src/modules/assessment/fullAssessmentModel");
const QuestionAndAnswer = require("../../src/modules/assessment/questionAndAnswerModel");
const QuickMiniAssessment = require("../../src/modules/assessment/quickMiniAssessmentModel");
const DailyQuickAssignment = require("../../src/modules/assessment/userQuickAssignmentModel");
const DailyChallenge = require("../../src/modules/game/dailyChallengeModel");
const User = require("../../src/modules/user/userModel");
const { useInMemoryDatabase } = require("../utils/db");
const {
    createFullAssessment,
    createQuestion,
    createQuickMini,
} = require("../utils/assessmentFixtures");
const { createGame } = require("../utils/gameFixtures");
const { createUser } = require("../utils/fixtures");

describe("tools/assessment-browser remove", () => {
    useInMemoryDatabase();

    const wireUp = async () => {
        const assessment = await createFullAssessment();
        const questions = await Promise.all([
            createQuestion(assessment),
            createQuestion(assessment),
        ]);
        const mini = await createQuickMini(assessment, questions);
        const user = await createUser();

        await User.updateOne(
            { _id: user._id },
            { quickMiniAssessmntId: mini._id },
        );
        await DailyQuickAssignment.create({
            userId: user._id,
            date: getCETMidnight(new Date()),
            quickAssessmentId: mini._id,
        });
        await DailyChallenge.create({
            date: getCETMidnight(new Date()),
            games: [],
            quickAssessmentId: mini._id,
        });

        return { assessment, mini, user };
    };

    it("should drop the minis and everything pointing at them", async () => {
        const { assessment, mini, user } = await wireUp();

        const result = await remove(String(assessment._id));

        expect(result).toContain("Cognitive");
        expect(await FullAssessment.countDocuments()).toBe(0);
        expect(await QuestionAndAnswer.countDocuments()).toBe(0);
        expect(await QuickMiniAssessment.countDocuments()).toBe(0);
        expect(
            await DailyQuickAssignment.countDocuments({
                quickAssessmentId: mini._id,
            }),
        ).toBe(0);
        expect(
            await DailyChallenge.countDocuments({
                quickAssessmentId: mini._id,
            }),
        ).toBe(0);
        expect(
            (await User.findById(user._id).lean()).quickMiniAssessmntId,
        ).toBeUndefined();
    });

    it("should rebuild today's challenge from the surviving minis", async () => {
        const { assessment } = await wireUp();
        const survivor = await createFullAssessment({
            mainCategory: "memory",
            stripeProductId: "prod_memory",
        });
        const kept = await createQuickMini(survivor, [
            await createQuestion(survivor),
        ]);
        await createGame();

        await remove(String(assessment._id));

        const today = await DailyChallenge.findOne({
            date: getCETMidnight(new Date()),
        }).lean();

        expect(String(today.quickAssessmentId)).toBe(String(kept._id));
    });

    it("should return null for an id that is not an assessment", async () => {
        expect(await remove("not-an-id")).toBeNull();
        expect(await remove(String(new mongoose.Types.ObjectId()))).toBeNull();
    });
});
