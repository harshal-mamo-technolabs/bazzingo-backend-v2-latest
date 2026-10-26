const User = require("../../src/modules/user/userModel");
const LandingPageHook = require("../../src/modules/lp/landingPageHookModel");
const { createUser } = require("../utils/fixtures");
const { useInMemoryDatabase } = require("../utils/db");
const {
    parseUtmParams,
    persistUtmDefaults,
    buildUtmMetadata,
    parseFlowId,
    parseUtmTouch,
    isNewTouch,
} = require("../../src/common/utils/utmParams");
const { mergeUtmMetadata } = require("../../src/modules/stripe/stripeService");
const {
    StripeElementsService,
} = require("../../src/modules/stripe-elements/stripeElementsService");
const {
    HelpscoutService,
} = require("../../src/modules/helpscout/helpscoutService");
const logger = require("../../src/config/logger");

const original = {
    utmSource: "google",
    utmCampaign: "brand",
    utmMedium: "cpc",
};
const replacement = {
    utmSource: "Klaviyo",
    utmCampaign: "reminder",
    utmMedium: "email",
};
const organic = {
    utmSource: "organic",
    utmCampaign: "organic",
    utmMedium: "organic",
};

describe("fixed UTM attribution", () => {
    useInMemoryDatabase();

    it("accepts flow link aliases and rejects invalid IDs without inventing a fallback", () => {
        for (const field of [
            "flowId",
            "flow_id",
            "klaviyo_flow_id",
            "utm_id",
        ]) {
            expect(parseFlowId({ [field]: "XHLfvC" })).toBe("XHLfvC");
        }
        expect(parseFlowId({})).toBeUndefined();
        expect(() => parseFlowId({ utm_id: ["XHLfvC", "other"] })).toThrow(
            "Invalid Klaviyo flow ID",
        );
        expect(() => parseFlowId({ utm_id: "x".repeat(129) })).toThrow(
            "Invalid Klaviyo flow ID",
        );
        const user = {
            ...original,
            flowId: "OLD",
            utmEmail: "old_email",
            $locals: {
                purchaseAttribution: { flowId: "XHLfvC", utmEmail: "Klaviyo" },
            },
        };
        expect(mergeUtmMetadata({}, user).flow_id).toBe("XHLfvC");
        expect(
            new StripeElementsService(logger).withUtmMetadata({}, user).flow_id,
        ).toBe("XHLfvC");
        expect(buildUtmMetadata(original)).not.toHaveProperty("flow_id");
    });

    it("defaults missing, blank and legacy placeholder values to organic", async () => {
        expect(
            parseUtmParams({ utm_source: "default", utm_campaign: " " }),
        ).toEqual(organic);
        const user = await createUser({
            utmSource: null,
            utmCampaign: " ",
            utmMedium: "default",
        });
        const stored = await User.collection.findOne({ _id: user._id });
        expect(stored).toMatchObject(organic);
        const hook = await LandingPageHook.create({
            uuid: "organic",
            utmSource: null,
        });
        expect(
            await LandingPageHook.collection.findOne({ _id: hook._id }),
        ).toMatchObject(organic);
    });

    it("treats only a visit with its own source or campaign as a new touch", () => {
        const hook = { ...original };
        expect(parseUtmTouch({ utm_medium: "klaviyo_email" })).toBeNull();
        expect(isNewTouch(hook, parseUtmTouch({ utm_medium: "x" }))).toBe(false);
        expect(isNewTouch(hook, parseUtmTouch(original))).toBe(false);
        expect(
            isNewTouch(
                hook,
                parseUtmTouch({ ...original, utmCampaign: "abandoned cart" }),
            ),
        ).toBe(true);
        // Known email: a different source alone is not a new touch (source is locked).
        expect(
            isNewTouch(
                { ...original, email: "a@b.co" },
                parseUtmTouch({ ...original, utmSource: "Klaviyo" }),
            ),
        ).toBe(false);
    });

    it.each([original, organic])(
        "prevents document and query updates to saved attribution %j",
        async (values) => {
            const user = await createUser(values);
            const hook = await LandingPageHook.create({
                uuid: "fixed",
                ...values,
            });
            for (const record of [user, hook]) {
                Object.assign(record, replacement);
                await record.save();
                await record.constructor.updateOne(
                    { _id: record._id },
                    { $set: replacement },
                );
                await record.constructor.updateOne(
                    { _id: record._id },
                    { $unset: { utmSource: 1 } },
                );
                // Hooks keep their visit's UTMs; users lock only the source.
                expect(
                    await record.collection.findOne({ _id: record._id }),
                ).toMatchObject(
                    record === user
                        ? { ...replacement, utmSource: values.utmSource }
                        : values,
                );
            }
        },
    );

    it("repairs legacy rows before sending Stripe metadata without altering saved values", async () => {
        const user = await createUser();
        await User.collection.updateOne(
            { _id: user._id },
            {
                $set: { utmSource: "google", utmCampaign: "default" },
                $unset: { utmMedium: 1 },
            },
        );
        const loaded = await User.findById(user._id);
        await persistUtmDefaults(loaded);
        expect(await User.collection.findOne({ _id: user._id })).toMatchObject({
            utmSource: "google",
            utmCampaign: "organic",
            utmMedium: "organic",
        });
        expect(buildUtmMetadata(loaded)).toEqual({
            utm_source: "google",
            utm_campaign: "organic",
            utm_medium: "organic",
        });
    });

    it("treats a purchase without its own touch as organic, keeping the locked source", () => {
        const user = { ...original, utmEmail: "Klaviyo" };
        const purchase = {
            utm_source: "google",
            utm_campaign: "organic",
            utm_medium: "organic",
        };
        expect(mergeUtmMetadata({ utm_medium: "email" }, user)).toMatchObject(
            purchase,
        );
        expect(
            new StripeElementsService(logger).withUtmMetadata(
                { utm_medium: "email" },
                user,
            ),
        ).toEqual(purchase);
        // Help Scout shows the user's profile, not a single purchase.
        expect(
            new HelpscoutService(logger).buildUtmIdentifyProperties(user),
        ).toEqual({ utm_source: "google", utm_campaign: "brand", utm_medium: "cpc" });
    });
});
