const { AssessmentController } = require("../../../src/modules/assessment/assessmentController");
const { unusedPurchaseIds } = require("../../../src/common/utils/entitlements");

// Mirrors production user 694241ad8f830e7a9c27f70b: 6 active iq-test
// assessments, 4 purchased and submitted, 2 never taken.
const IQ = ["A", "B", "C", "D", "E", "F"].map((id) => ({
    _id: id,
    mainCategory: "iq-test",
    active: true,
}));
const COMPLETED = ["A", "B", "C", "D"];

const build = ({ completed = COMPLETED, challenge = null } = {}) => {
    const controller = new AssessmentController(
        {
            findActiveByCategory: async () => IQ,
            findScores: async () =>
                completed.map((assessmentId) => ({ assessmentId })),
        },
        null, null, null, null, null, null,
        { info: () => {}, error: () => {} },
    );

    controller.assessmentFromTodaysChallenge = async () => challenge;

    return controller;
};

const run = async () => {
    const controller = build();
    const completedIds = await controller.completedAssessmentIds("u1");

    // The bug: 100 draws used to hand back an already-completed assessment.
    for (let i = 0; i < 100; i++) {
        const { assessment, isAssessmentPurchased } =
            await controller.selectForCategory({
                category: "iq-test",
                userId: "u1",
                purchasedAssessments: COMPLETED.map((id) => ({
                    _id: id,
                    mainCategory: "iq-test",
                })),
                completedIds,
                unusedPurchases: unusedPurchaseIds(COMPLETED, completedIds),
            });

        console.assert(
            ["E", "F"].includes(assessment._id),
            `returned already-completed assessment ${assessment._id}`,
        );
        console.assert(
            isAssessmentPurchased === false,
            "an unseen assessment must not be flagged as purchased",
        );
    }

    // A purchased-but-unsubmitted assessment still wins over an unseen one.
    const pending = build();
    const picked = await pending.selectForCategory({
        category: "iq-test",
        userId: "u1",
        purchasedAssessments: [{ _id: "E", mainCategory: "iq-test" }],
        completedIds,
        unusedPurchases: unusedPurchaseIds(["E"], completedIds),
    });
    console.assert(
        picked.assessment._id === "E" && picked.assessment.isAssessmentPurchased !== false,
        "unsubmitted purchase should be offered first",
    );

    // Exhausted category may repeat rather than returning nothing.
    const exhausted = build({ completed: IQ.map((a) => a._id) });
    const allDone = await exhausted.completedAssessmentIds("u1");
    const last = await exhausted.selectForCategory({
        category: "iq-test",
        userId: "u1",
        purchasedAssessments: [],
        completedIds: allDone,
        unusedPurchases: new Set(),
    });
    console.assert(last.assessment, "exhausted category must still return one");

    // The reported bug: buying an assessment again after completing it must
    // hand it back as purchased, not send the user to the payment modal.
    const rebought = build();
    const reboughtIds = await rebought.completedAssessmentIds("u1");
    const again = await rebought.selectForCategory({
        category: "iq-test",
        userId: "u1",
        purchasedAssessments: [{ _id: "A", mainCategory: "iq-test" }],
        completedIds: reboughtIds,
        unusedPurchases: unusedPurchaseIds(["A", "A"], reboughtIds),
    });
    console.assert(
        again.assessment._id === "A" && again.isAssessmentPurchased === true,
        `re-purchased assessment must come back as purchased, got ${again.assessment._id} purchased=${again.isAssessmentPurchased}`,
    );

    // Anonymous callers keep the old any-assessment behaviour.
    const anon = await build().selectForCategory({
        category: "iq-test",
        userId: null,
        purchasedAssessments: [],
        completedIds: new Set(),
        unusedPurchases: new Set(),
    });
    console.assert(anon.assessment, "anonymous must still get an assessment");

    console.log("selectForCategory: all assertions passed");
};

run().catch((err) => {
    console.error(err);
    process.exit(1);
});
