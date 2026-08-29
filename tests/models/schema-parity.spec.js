const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

const MODULES_ROOT = path.join(__dirname, "../../src/modules");

const EXPECTED_COLLECTIONS = {
    AccountDeletionFeedback: "account_deletion_feedback",
    AdhdAssessment: "adhdassessments",
    AdhdAssessmentScore: "adhdassessmentscores",
    AdhdQuestionAndAnswer: "adhdquestionandanswers",
    Admin: "admins",
    AssessmentScore: "assessmentscores",
    Badge: "badges",
    BadgeUnlock: "badgeunlocks",
    DailyChallenge: "dailychallenges",
    DailyQuickAssignment: "dailyquickassignments",
    DailySuggestion: "dailysuggestions",
    EmotionalIntelligenceAssessment: "emotionalintelligenceassessments",
    EmotionalIntelligenceAssessmentScore:
        "emotionalintelligenceassessmentscores",
    EmotionalIntelligenceQuestionAndAnswer:
        "emotionalintelligencequestionandanswers",
    FullAssessment: "fullassessments",
    Game: "games",
    GamePlay: "gameplays",
    GameScore: "gamescores",
    KlaviyoBackup: "klaviyo_backups",
    LandingPageHook: "landingpagehooks",
    Leaderboard: "leaderboards",
    Notification: "notifications",
    NotificationReceipt: "notificationreceipts",
    Order: "orders",
    Plan: "plans",
    PriceCatalog: "pricecatalogs",
    PushSubscription: "pushsubscriptions",
    QuestionAndAnswer: "questionandanswers",
    QuickMiniAssessment: "quickminiassessments",
    Subscription: "subscriptions",
    User: "users",
    UserDailyActivity: "userdailyactivities",
};

const loadModels = () => {
    const models = [];

    for (const moduleName of fs.readdirSync(MODULES_ROOT)) {
        const moduleDir = path.join(MODULES_ROOT, moduleName);

        if (!fs.statSync(moduleDir).isDirectory()) {
            continue;
        }

        for (const file of fs.readdirSync(moduleDir)) {
            if (file.endsWith("Model.js")) {
                models.push({
                    file: `${moduleName}/${file}`,
                    model: require(path.join(moduleDir, file)),
                });
            }
        }
    }

    return models;
};

describe("model parity with the v1 database", () => {
    const models = loadModels();

    afterAll(async () => {
        await mongoose.disconnect();
    });

    it("should register every migrated model", () => {
        expect(models).toHaveLength(Object.keys(EXPECTED_COLLECTIONS).length);
    });

    it.each(models.map(({ file, model }) => [model.modelName, file, model]))(
        "%s (%s) should keep its v1 collection",
        (modelName, file, model) => {
            expect(EXPECTED_COLLECTIONS[modelName]).toBeDefined();
            expect(model.collection.name).toBe(EXPECTED_COLLECTIONS[modelName]);
        },
    );

    it("should keep the model names that do not match their file name", () => {
        const byFile = Object.fromEntries(
            models.map(({ file, model }) => [file, model.modelName]),
        );

        expect(byFile["assessment/userQuickAssignmentModel.js"]).toBe(
            "DailyQuickAssignment",
        );
        expect(byFile["game/dailyGameSuggestionModel.js"]).toBe(
            "DailySuggestion",
        );
    });
});
