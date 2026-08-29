const mongoose = require("mongoose");
const logger = require("../../src/config/logger");
const AdhdAssessment = require("../../src/modules/adhd-assessment/adhdAssessmentModel");
const AdhdAssessmentScore = require("../../src/modules/adhd-assessment/adhdAssessmentScoreModel");
const Order = require("../../src/modules/stripe/orderModel");
const {
    AdhdAssessmentService,
} = require("../../src/modules/adhd-assessment/adhdAssessmentService");
const { OrderService } = require("../../src/modules/stripe/orderService");
const { useInMemoryDatabase } = require("../utils/db");
const { createUser } = require("../utils/fixtures");

describe("AdhdAssessmentService.pickForUser", () => {
    useInMemoryDatabase();

    let service;
    let user;

    beforeEach(async () => {
        service = new AdhdAssessmentService(logger, new OrderService(logger));
        user = await createUser();
    });

    const addAssessment = (overrides = {}) =>
        AdhdAssessment.create({
            title: "ADHD screener",
            questions: 10,
            subCategories: ["inattention"],
            ...overrides,
        });

    const purchase = (assessment, overrides = {}) =>
        Order.create({
            userId: user._id,
            assessmentId: assessment._id,
            status: "succeeded",
            ...overrides,
        });

    const complete = (assessment, overrides = {}) =>
        AdhdAssessmentScore.create({
            userId: user._id,
            type: "full",
            assessmentId: assessment._id,
            date: new Date(),
            totalScore: 5,
            ...overrides,
        });

    describe("without a user", () => {
        it("should return nothing when no assessment is active", async () => {
            expect(await service.pickForUser(null)).toEqual({
                assessment: null,
                isAssessmentPurchased: false,
            });
        });

        it("should pick an active assessment", async () => {
            await addAssessment();

            const result = await service.pickForUser(null);

            expect(result.assessment.title).toBe("ADHD screener");
            expect(result.isAssessmentPurchased).toBe(false);
        });

        it("should ignore inactive assessments", async () => {
            await addAssessment({ active: false });

            const result = await service.pickForUser(null);

            expect(result.assessment).toBeNull();
        });
    });

    describe("with a user", () => {
        it("should prefer a purchased assessment that is not submitted", async () => {
            await addAssessment({ title: "Free" });
            const bought = await addAssessment({ title: "Bought" });
            await purchase(bought);

            const result = await service.pickForUser(user._id);

            expect(result.assessment.title).toBe("Bought");
            expect(result.isAssessmentPurchased).toBe(true);
        });

        it("should ignore a purchase that was not successful", async () => {
            const bought = await addAssessment({ title: "Bought" });
            await purchase(bought, { status: "processing" });

            const result = await service.pickForUser(user._id);

            expect(result.isAssessmentPurchased).toBe(false);
        });

        it("should ignore another user's purchase", async () => {
            const other = await createUser({ email: "other@bazzingo.com" });
            const bought = await addAssessment({ title: "Bought" });
            await purchase(bought, { userId: other._id });

            const result = await service.pickForUser(user._id);

            expect(result.isAssessmentPurchased).toBe(false);
        });

        it("should skip a purchased assessment the user already submitted", async () => {
            const bought = await addAssessment({ title: "Bought" });
            await purchase(bought);
            await complete(bought);
            await addAssessment({ title: "Free" });

            const result = await service.pickForUser(user._id);

            expect(result.assessment.title).toBe("Free");
            expect(result.isAssessmentPurchased).toBe(false);
        });

        it("should never return an assessment the user completed", async () => {
            const done = await addAssessment({ title: "Done" });
            await complete(done);

            const result = await service.pickForUser(user._id);

            expect(result.assessment).toBeNull();
        });

        it("should never return a purchased assessment as a free pick", async () => {
            const bought = await addAssessment({ title: "Bought" });
            await purchase(bought);
            await complete(bought);

            const result = await service.pickForUser(user._id);

            expect(result.assessment).toBeNull();
        });

        it("should skip a purchased assessment that is inactive", async () => {
            const bought = await addAssessment({
                title: "Bought",
                active: false,
            });
            await purchase(bought);
            const free = await addAssessment({ title: "Free" });

            const result = await service.pickForUser(user._id);

            expect(String(result.assessment._id)).toBe(String(free._id));
        });

        it("should return an unpurchased active assessment", async () => {
            const free = await addAssessment({ title: "Free" });

            const result = await service.pickForUser(user._id);

            expect(String(result.assessment._id)).toBe(String(free._id));
            expect(result.isAssessmentPurchased).toBe(false);
        });

        it("should ignore orders without an assessmentId", async () => {
            await addAssessment({ title: "Free" });
            await Order.create({
                userId: user._id,
                status: "succeeded",
                itemType: "credit_pack",
            });

            const result = await service.pickForUser(user._id);

            expect(result.assessment.title).toBe("Free");
        });

        it("should return nothing when every assessment is completed", async () => {
            const first = await addAssessment({ title: "First" });
            const second = await addAssessment({ title: "Second" });
            await complete(first);
            await complete(second, {
                assessmentId: second._id,
            });

            const result = await service.pickForUser(user._id);

            expect(result.assessment).toBeNull();
        });

        it("should treat a missing user id as anonymous", async () => {
            await addAssessment();

            const result = await service.pickForUser(undefined);

            expect(result.assessment).not.toBeNull();
        });

        it("should ignore a completed quick score when picking", async () => {
            const assessment = await addAssessment({ title: "Only" });
            await complete(assessment, { type: "quick" });

            const result = await service.pickForUser(user._id);

            expect(String(result.assessment._id)).toBe(String(assessment._id));
        });
    });
});
