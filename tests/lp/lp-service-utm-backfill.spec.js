const logger = require("../../src/config/logger");
const { LpService } = require("../../src/modules/lp/lpService");
const User = require("../../src/modules/user/userModel");
const { useInMemoryDatabase } = require("../utils/db");
const { createUser } = require("../utils/fixtures");

describe("LpService.backfillUserUtmFromHook", () => {
    useInMemoryDatabase();

    const service = new LpService(logger);

    it("backfills the utm email alone, even when source/campaign/medium are all default", async () => {
        await createUser({ email: "lead@bazzingo.com" });

        await service.backfillUserUtmFromHook({
            email: "lead@bazzingo.com",
            utmSource: "default",
            utmCampaign: "default",
            utmMedium: "default",
            utmEmail: "klaviyo",
        });

        const user = await User.findOne({ email: "lead@bazzingo.com" });
        expect(user.utmEmail).toBe("klaviyo");
    });

    it("does not overwrite an existing utm email on the user", async () => {
        await createUser({ email: "lead@bazzingo.com", utmEmail: "klaviyo" });

        await service.backfillUserUtmFromHook({
            email: "lead@bazzingo.com",
            utmEmail: "newsletter",
        });

        const user = await User.findOne({ email: "lead@bazzingo.com" });
        expect(user.utmEmail).toBe("klaviyo");
    });

    it("does nothing without any real utm value at all", async () => {
        await createUser({ email: "lead@bazzingo.com" });

        await service.backfillUserUtmFromHook({
            email: "lead@bazzingo.com",
            utmSource: "default",
            utmCampaign: "default",
            utmMedium: "default",
        });

        const user = await User.findOne({ email: "lead@bazzingo.com" });
        expect(user.utmEmail).toBeUndefined();
    });
});
