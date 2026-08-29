const logger = require("../../src/config/logger");
const Badge = require("../../src/modules/badge/badgeModel");
const BadgeUnlock = require("../../src/modules/badge/badgeUnlockModel");
const Game = require("../../src/modules/game/gameModel");
const GameScore = require("../../src/modules/game/gameScoreModel");
const AssessmentScore = require("../../src/modules/assessment/assessmentScoreModel");
const UserDailyActivity = require("../../src/modules/streak/userDailyActivityModel");
const { badges } = require("../../src/modules/badge/badgeData");
const { BadgeService } = require("../../src/modules/badge/badgeService");
const { useInMemoryDatabase } = require("../utils/db");
const { createUser } = require("../utils/fixtures");

describe("BadgeService", () => {
    useInMemoryDatabase();

    let service;
    let user;

    beforeEach(async () => {
        service = new BadgeService(logger);
        await Badge.insertMany(badges);
        user = await createUser();
    });

    const badgeIdFor = async (name) =>
        (await Badge.findOne({ name }))._id.toString();

    const unlockedNames = async (userId) => {
        const unlocks = await BadgeUnlock.find({ userId }).populate("badgeId");
        return unlocks.map((unlock) => unlock.badgeId.name).sort();
    };

    describe("initializeBadges", () => {
        it("should load the active badges into the cache", async () => {
            await service.initializeBadges();

            expect(service.badges.size).toBe(badges.length);
        });

        it("should not throw when the badge query fails", async () => {
            const spy = jest.spyOn(Badge, "find").mockReturnValueOnce({
                lean: () => Promise.reject(new Error("db is down")),
            });

            await expect(service.initializeBadges()).resolves.toBeUndefined();
            spy.mockRestore();
        });
    });

    describe("unlockLeaderboardRookieBadge", () => {
        it("should unlock the badge on the first call", async () => {
            const result = await service.unlockLeaderboardRookieBadge(user._id);

            expect(result.badge.name).toBe("leaderboard-rookie");
            expect(await unlockedNames(user._id)).toEqual([
                "leaderboard-rookie",
            ]);
        });

        it("should return null when it is already unlocked", async () => {
            await service.unlockLeaderboardRookieBadge(user._id);

            const result = await service.unlockLeaderboardRookieBadge(user._id);

            expect(result).toBeNull();
        });

        it("should never create a duplicate unlock", async () => {
            await service.unlockLeaderboardRookieBadge(user._id);
            await service.unlockLeaderboardRookieBadge(user._id);

            expect(await BadgeUnlock.countDocuments({ userId: user._id })).toBe(
                1,
            );
        });

        it("should return null when the badge is not seeded", async () => {
            await Badge.deleteMany({ name: "leaderboard-rookie" });
            const freshService = new BadgeService(logger);

            const result = await freshService.unlockLeaderboardRookieBadge(
                user._id,
            );

            expect(result).toBeNull();
        });
    });

    describe("unlockEarlyAdopterBadge", () => {
        it("should unlock for one of the first 1000 users", async () => {
            const result = await service.unlockEarlyAdopterBadge(user._id);

            expect(result.badge.name).toBe("early-adopter");
        });

        it("should record the user rank in the unlock context", async () => {
            const result = await service.unlockEarlyAdopterBadge(user._id);

            expect(result.context.userRank).toBe(1);
        });

        it("should return null when it is already unlocked", async () => {
            await service.unlockEarlyAdopterBadge(user._id);

            expect(await service.unlockEarlyAdopterBadge(user._id)).toBeNull();
        });
    });

    describe("checkAndUnlockBadges for games", () => {
        const playLogicGames = async (count, score = 180) => {
            const game = await Game.create({
                name: "Logic Puzzle",
                category: "Logic",
                url: "https://games.bazzingo.com/logic",
            });

            for (let i = 0; i < count; i += 1) {
                await GameScore.create({
                    userId: user._id,
                    gameId: game._id,
                    score,
                    suggestedDate: new Date(
                        Date.now() - i * 24 * 60 * 60 * 1000,
                    ),
                });
            }
        };

        it("should unlock logic-master after three qualifying scores", async () => {
            await playLogicGames(3);

            const unlocked = await service.checkAndUnlockBadges(user._id, {
                type: "game",
                gameCategory: "Logic",
            });

            expect(unlocked.map((u) => u.badge.name)).toContain("logic-master");
        });

        it("should not unlock logic-master below three qualifying scores", async () => {
            await playLogicGames(2);

            const unlocked = await service.checkAndUnlockBadges(user._id, {
                type: "game",
                gameCategory: "Logic",
            });

            expect(unlocked.map((u) => u.badge.name)).not.toContain(
                "logic-master",
            );
        });

        it("should ignore scores below the logic threshold", async () => {
            await playLogicGames(3, 179);

            const unlocked = await service.checkAndUnlockBadges(user._id, {
                type: "game",
                gameCategory: "Logic",
            });

            expect(unlocked.map((u) => u.badge.name)).not.toContain(
                "logic-master",
            );
        });

        it("should unlock game-explorer at ten unique games", async () => {
            for (let i = 0; i < 10; i += 1) {
                const game = await Game.create({
                    name: `Game ${i}`,
                    category: "Logic",
                    url: `https://games.bazzingo.com/${i}`,
                });
                await GameScore.create({
                    userId: user._id,
                    gameId: game._id,
                    score: 10,
                    suggestedDate: new Date(),
                });
            }

            const unlocked = await service.checkAndUnlockBadges(user._id, {
                type: "game",
            });

            expect(unlocked.map((u) => u.badge.name)).toContain(
                "game-explorer",
            );
        });

        it("should never unlock the same badge twice", async () => {
            await playLogicGames(3);
            await service.checkAndUnlockBadges(user._id, {
                type: "game",
                gameCategory: "Logic",
            });

            const second = await service.checkAndUnlockBadges(user._id, {
                type: "game",
                gameCategory: "Logic",
            });

            expect(second.map((u) => u.badge.name)).not.toContain(
                "logic-master",
            );
        });

        it("should return an empty list when a criteria query fails", async () => {
            const spy = jest.spyOn(Game, "find").mockImplementationOnce(() => {
                throw new Error("db is down");
            });

            const unlocked = await service.checkAndUnlockBadges(user._id, {
                type: "game",
                gameCategory: "Logic",
            });

            expect(unlocked).toEqual([]);
            spy.mockRestore();
        });
    });

    describe("checkAndUnlockBadges for assessments", () => {
        it("should unlock smart-start on a first iq test of 100 or more", async () => {
            const unlocked = await service.checkAndUnlockBadges(user._id, {
                type: "assessment",
                mainCategory: "iq-test",
                iqScore: 100,
            });

            expect(unlocked.map((u) => u.badge.name)).toContain("smart-start");
        });

        it("should not unlock smart-start below 100", async () => {
            const unlocked = await service.checkAndUnlockBadges(user._id, {
                type: "assessment",
                mainCategory: "iq-test",
                iqScore: 99,
            });

            expect(unlocked.map((u) => u.badge.name)).not.toContain(
                "smart-start",
            );
        });

        it("should not unlock smart-start when a full iq test already exists", async () => {
            await AssessmentScore.create({
                userId: user._id,
                type: "full",
                assessmentId: user._id,
                mainCategory: "iq-test",
                date: new Date(),
                totalScore: 10,
            });

            const unlocked = await service.checkAndUnlockBadges(user._id, {
                type: "assessment",
                mainCategory: "iq-test",
                iqScore: 130,
            });

            expect(unlocked.map((u) => u.badge.name)).not.toContain(
                "smart-start",
            );
        });

        it("should unlock brain-booster at 120", async () => {
            const unlocked = await service.checkAndUnlockBadges(user._id, {
                type: "assessment",
                mainCategory: "iq-test",
                iqScore: 120,
            });

            expect(unlocked.map((u) => u.badge.name)).toContain(
                "brain-booster",
            );
        });

        it("should unlock genius-certified at 140", async () => {
            const unlocked = await service.checkAndUnlockBadges(user._id, {
                type: "assessment",
                mainCategory: "iq-test",
                iqScore: 140,
            });

            expect(unlocked.map((u) => u.badge.name)).toContain(
                "genius-certified",
            );
        });

        it("should not unlock genius-certified below 140", async () => {
            const unlocked = await service.checkAndUnlockBadges(user._id, {
                type: "assessment",
                mainCategory: "iq-test",
                iqScore: 139,
            });

            expect(unlocked.map((u) => u.badge.name)).not.toContain(
                "genius-certified",
            );
        });

        it("should unlock first-milestone on a full assessment", async () => {
            const unlocked = await service.checkAndUnlockBadges(user._id, {
                type: "assessment",
                assessmentType: "full",
            });

            expect(unlocked.map((u) => u.badge.name)).toContain(
                "first-milestone",
            );
        });
    });

    describe("unlockBadge", () => {
        it("should store the context on the unlock", async () => {
            const badgeId = await badgeIdFor("early-adopter");

            await service.unlockBadge(user._id, badgeId, { userRank: 42 });

            const unlock = await BadgeUnlock.findOne({ userId: user._id });
            expect(unlock.context.userRank).toBe(42);
        });

        it("should stamp unlockedAt", async () => {
            const badgeId = await badgeIdFor("early-adopter");

            const result = await service.unlockBadge(user._id, badgeId, {});

            expect(result.unlockedAt).toBeInstanceOf(Date);
        });

        it("should return null when the unlock cannot be written", async () => {
            const badgeId = await badgeIdFor("early-adopter");
            await service.unlockBadge(user._id, badgeId, {});

            const result = await service.unlockBadge(user._id, badgeId, {});

            expect(result).toBeNull();
        });
    });

    describe("consecutive day helpers", () => {
        const daysAgo = (days) =>
            new Date(Date.now() - days * 24 * 60 * 60 * 1000);

        it("should count consecutive days", () => {
            const activities = [
                { createdAt: daysAgo(3) },
                { createdAt: daysAgo(2) },
                { createdAt: daysAgo(1) },
            ];

            expect(service.countConsecutiveDays(activities, 3)).toBe(3);
        });

        it("should stop counting at the first gap", () => {
            const activities = [
                { createdAt: daysAgo(9) },
                { createdAt: daysAgo(2) },
                { createdAt: daysAgo(1) },
            ];

            expect(service.countConsecutiveDays(activities, 3)).toBe(1);
        });

        it("should return 0 below the minimum length", () => {
            expect(service.countConsecutiveDays([{}, {}], 3)).toBe(0);
        });
    });

    describe("streak-starter", () => {
        it("should unlock after three consecutive days of play", async () => {
            const daysAgo = (days) =>
                new Date(Date.now() - days * 24 * 60 * 60 * 1000);

            for (const day of [2, 1, 0]) {
                await UserDailyActivity.create({
                    userId: user._id,
                    date: daysAgo(day),
                    isGamePlayed: true,
                    createdAt: daysAgo(day),
                });
            }

            const unlocked = await service.checkAndUnlockBadges(user._id, {
                type: "game",
            });

            expect(unlocked.map((u) => u.badge.name)).toContain(
                "streak-starter",
            );
        });
    });
});
