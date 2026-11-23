const {
    renderProfileMarkup,
} = require("../../src/modules/helpscout/profileSidebarView");
const {
    renderHelpScoutProfileSidebarPage,
} = require("../../src/modules/helpscout/helpscoutSidebarTemplate");
const { runInNewContext } = require("node:vm");

describe("Bazzingo Klaviyo profile view", () => {
    const profile = {
        id: "demo-profile",
        email: "alex@example.com",
        firstName: "Alex",
        lastName: "Morgan",
        updated: "2026-11-23T10:00:00Z",
        properties: {
            "Current Plan name": "Monthly",
            "Current Plan status": "active",
            "bazingo-cancelled immediately": false,
            "total purchased Logic": 0,
            utm_source: "organic",
        },
    };
    it("groups the actual Bazzingo properties with readable labels and dates", () => {
        const html = renderProfileMarkup(profile, profile.email);
        expect(html).toContain("Alex Morgan");
        for (const title of [
            "Subscription",
            "Assessments &amp; purchases",
            "Customer details",
            "Attribution",
        ])
            expect(html).toContain(title);
        expect(html).toContain("Cancelled immediately");
        expect(html).not.toContain("bazingo-");
        expect(html).toContain("23 Nov 2026, 10:00 UTC");
        expect(html).toContain("<dd>0</dd>");
        expect(html).toContain('class="badge">No</span>');
    });
    it("escapes profile content and preserves URLs, objects, arrays, and unknown properties", () => {
        const html = renderProfileMarkup(
            {
                ...profile,
                firstName: "<img src=x onerror=alert(1)>",
                properties: {
                    "bazzingo:resume_url": 'https://example.com/?token="demo"',
                    "<script>": "<script>alert(1)</script>",
                    Metadata: { count: 0 },
                    Labels: ["one", "two"],
                },
            },
            profile.email,
        );
        expect(html).not.toContain("<img src=x");
        expect(html).not.toContain("<script>alert(1)</script>");
        expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
        expect(html).toContain("View URL");
        expect(html).toContain("token=&quot;demo&quot;");
        expect(html).toContain("&quot;count&quot;: 0");
        expect(html).toContain("&quot;two&quot;");
        expect(html).toContain("Other properties");
    });
    it("handles profiles without properties and missing Klaviyo profiles", () => {
        expect(
            renderProfileMarkup({ id: "only-id" }, "fallback@example.com"),
        ).toContain("fallback@example.com");
        const html = renderProfileMarkup(null, "<missing>@example.com");
        expect(html).toContain("No Klaviyo profile found");
        expect(html).toContain("&lt;missing&gt;");
    });
    it("embeds a self-contained renderer that produces the same safe browser markup", () => {
        const browserRender = runInNewContext(
            "(" + renderProfileMarkup.toString() + ")",
        );
        expect(browserRender(profile, profile.email)).toBe(
            renderProfileMarkup(profile, profile.email),
        );
        const page = renderHelpScoutProfileSidebarPage("test-token");
        expect(page).toContain("HelpScout.setAppHeight(height)");
        expect(page).toContain("HelpScout.watchApplicationContext");
        expect(page).toContain("Refresh profile");
    });
});
