// Self-contained because this same renderer is embedded in the sidebar browser module.
function renderProfileMarkup(profile, email) {
    const escape = (value) =>
        String(value).replace(
            /[&<>"']/g,
            (c) =>
                ({
                    "&": "&amp;",
                    "<": "&lt;",
                    ">": "&gt;",
                    '"': "&quot;",
                    "'": "&#39;",
                })[c],
        );
    const field = (label, value) => {
        if (value === undefined || value === null || value === "") return "";
        let display;
        if (typeof value === "boolean")
            display = `<span class="badge">${value ? "Yes" : "No"}</span>`;
        else if (typeof value === "string" && /^https?:\/\//i.test(value))
            display = `<details class="profile-url"><summary>View URL</summary><code>${escape(value)}</code></details>`;
        else {
            let text =
                typeof value === "object"
                    ? JSON.stringify(value, null, 2)
                    : String(value);
            if (
                typeof value === "string" &&
                /^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value) &&
                !Number.isNaN(Date.parse(value))
            )
                text =
                    new Date(value).toLocaleString("en-GB", {
                        dateStyle: "medium",
                        ...(value.includes("T") ? { timeStyle: "short" } : {}),
                        timeZone: "UTC",
                    }) + (value.includes("T") ? " UTC" : "");
            display = escape(text);
        }
        return `<div class="profile-row"><dt>${escape(label)}</dt><dd>${display}</dd></div>`;
    };
    if (!profile)
        return `<p class="customer">${escape(email)}</p><p class="notice">No Klaviyo profile found for this customer.</p>`;
    const name = [profile.firstName, profile.lastName]
        .filter(Boolean)
        .join(" ");
    const groups = {
        Subscription: [],
        "Assessments & purchases": [],
        "Customer details": [],
        Attribution: [],
        "Other properties": [],
    };
    for (const [label, value] of [
        ["Phone", profile.phoneNumber],
        ["External ID", profile.externalId],
        ["Klaviyo profile ID", profile.id],
        ["Created", profile.created],
        ["Updated", profile.updated],
        ["Location", profile.location],
    ]) {
        const row = field(label, value);
        if (row) groups["Customer details"].push(row);
    }
    for (const [key, value] of Object.entries(profile.properties || {}).sort(
        ([a], [b]) => a.localeCompare(b),
    )) {
        const clean = key
            .replace(/^bazz?ingo[:\-]/i, "")
            .replace(/_/g, " ")
            .trim();
        const label = clean.charAt(0).toUpperCase() + clean.slice(1);
        const group =
            /plan|subscription|trial|cancel|billing|stayed|monthly or yearly|access ends/i.test(
                clean,
            )
                ? "Subscription"
                : /purchased|assessment|credits|allowance|balance|score|rank|quiz/i.test(
                        clean,
                    )
                  ? "Assessments & purchases"
                  : /utm|source|campaign|medium|landing page/i.test(clean)
                    ? "Attribution"
                    : /^(?:full name|first name|last name|email|phone|gender|birth|city|state|country|created|updated|resume|is user)/i.test(
                            clean,
                        )
                      ? "Customer details"
                      : "Other properties";
        const row = field(label, value);
        if (row) groups[group].push(row);
    }
    return (
        `<div class="profile-identity">${name ? `<strong>${escape(name)}</strong>` : ""}<p>${escape(profile.email || email)}</p></div><p class="profile-note">Klaviyo profile data · dates shown in UTC</p>` +
        Object.entries(groups)
            .map(([title, rows]) =>
                rows.length
                    ? `<details class="profile-group${title === "Assessments & purchases" ? " usage" : ""}"${["Subscription", "Assessments & purchases"].includes(title) ? " open" : ""}><summary>${escape(title)}<span>${rows.length} ${rows.length === 1 ? "field" : "fields"}</span></summary><dl class="profile-fields">${rows.join("")}</dl></details>`
                    : "",
            )
            .join("")
    );
}
module.exports = { renderProfileMarkup };
