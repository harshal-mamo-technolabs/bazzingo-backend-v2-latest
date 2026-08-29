const mongoose = require("mongoose");
const logger = require("../../src/config/logger");
const Leaderboard = require("../../src/modules/leaderboard/leaderboardModel");
const {
    LeaderboardService,
} = require("../../src/modules/leaderboard/leaderboardService");
const { useInMemoryDatabase } = require("../utils/db");

describe("LeaderboardService.syncProfile", () => {
    useInMemoryDatabase();

    const service = new LeaderboardService(logger);
    const userId = () => new mongoose.Types.ObjectId();

    describe("when the user has no row yet", () => {
        it("should create the row", async () => {
            const id = userId();

            await service.syncProfile({
                userId: id,
                age: 27,
                country: "India",
                avatar: "a.png",
                name: "Harshal",
            });

            const row = await Leaderboard.findOne({ userId: id });
            expect(row).not.toBeNull();
            expect(row.name).toBe("Harshal");
            expect(row.avatar).toBe("a.png");
        });

        it("should lowercase the country", async () => {
            const id = userId();

            await service.syncProfile({ userId: id, country: "India" });

            const row = await Leaderboard.findOne({ userId: id });
            expect(row.country).toBe("india");
        });

        it("should derive the age group from the age", async () => {
            const id = userId();

            await service.syncProfile({ userId: id, age: 27 });

            const row = await Leaderboard.findOne({ userId: id });
            expect(row.ageGroup).toBe("25-34");
        });

        it("should start both score buckets at zero", async () => {
            const id = userId();

            await service.syncProfile({ userId: id, age: 27 });

            const row = await Leaderboard.findOne({ userId: id });
            expect(row.game.totalScore).toBe(0);
            expect(row.assessment.totalScore).toBe(0);
        });

        it("should give the first row rank 1 everywhere", async () => {
            const id = userId();

            await service.syncProfile({
                userId: id,
                age: 27,
                country: "India",
            });

            const row = await Leaderboard.findOne({ userId: id });
            expect(row.gameGlobalRank).toBe(1);
            expect(row.assessmentGlobalRank).toBe(1);
            expect(row.gameCountryRank).toBe(1);
            expect(row.gameAgeGroupRank).toBe(1);
        });

        it("should place a later row after the existing highest rank", async () => {
            await service.syncProfile({ userId: userId(), age: 27 });
            const second = userId();

            await service.syncProfile({ userId: second, age: 27 });

            const row = await Leaderboard.findOne({ userId: second });
            expect(row.gameGlobalRank).toBe(2);
        });

        it("should rank per country independently of the global rank", async () => {
            await service.syncProfile({ userId: userId(), country: "India" });
            const second = userId();

            await service.syncProfile({ userId: second, country: "Germany" });

            const row = await Leaderboard.findOne({ userId: second });
            expect(row.gameGlobalRank).toBe(2);
            expect(row.gameCountryRank).toBe(1);
        });
    });

    describe("when the user already has a row", () => {
        it("should update the changed fields", async () => {
            const id = userId();
            await service.syncProfile({ userId: id, name: "Harshal" });

            await service.syncProfile({ userId: id, name: "Harshal Chauhan" });

            const row = await Leaderboard.findOne({ userId: id });
            expect(row.name).toBe("Harshal Chauhan");
        });

        it("should not create a second row", async () => {
            const id = userId();
            await service.syncProfile({ userId: id, name: "Harshal" });

            await service.syncProfile({ userId: id, name: "Changed" });

            expect(await Leaderboard.countDocuments({ userId: id })).toBe(1);
        });

        it("should leave the ranks untouched", async () => {
            const id = userId();
            await service.syncProfile({ userId: id, name: "Harshal" });
            await Leaderboard.updateOne({ userId: id }, { gameGlobalRank: 7 });

            await service.syncProfile({ userId: id, name: "Changed" });

            const row = await Leaderboard.findOne({ userId: id });
            expect(row.gameGlobalRank).toBe(7);
        });

        it("should leave the scores untouched", async () => {
            const id = userId();
            await service.syncProfile({ userId: id, name: "Harshal" });
            await Leaderboard.updateOne(
                { userId: id },
                { "game.totalScore": 500 },
            );

            await service.syncProfile({ userId: id, country: "Germany" });

            const row = await Leaderboard.findOne({ userId: id });
            expect(row.game.totalScore).toBe(500);
        });

        it("should not touch fields that were not passed", async () => {
            const id = userId();
            await service.syncProfile({
                userId: id,
                name: "Harshal",
                country: "India",
            });

            await service.syncProfile({ userId: id, name: "Changed" });

            const row = await Leaderboard.findOne({ userId: id });
            expect(row.country).toBe("india");
        });
    });
});
