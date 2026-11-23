/* Browser module. Like the existing profile panel, use the pinned Help Scout SDK. */
const panel = document.getElementById("sidebar-panel");
const config = document.getElementById("sidebar-config");
let currentKey = config.dataset.contextId || "";
let latestContext;
let activeRequest;
let revision = 0;

function message(text) {
    const p = document.createElement("p");
    p.setAttribute("role", "status");
    p.textContent = text;
    panel.replaceChildren(p);
}
const timeout = setTimeout(
    () =>
        message(
            "Help Scout has not supplied customer details. Reload the sidebar to retry.",
        ),
    10000,
);

async function load(action, body) {
    activeRequest?.abort();
    activeRequest = new AbortController();
    const ownRevision = ++revision;
    panel.querySelectorAll("button").forEach((button) => {
        button.disabled = true;
    });
    try {
        const response = await fetch(action, {
            method: "POST",
            body,
            signal: activeRequest.signal,
            credentials: "omit",
        });
        const html = await response.text();
        if (ownRevision !== revision) return;
        const page = new DOMParser().parseFromString(html, "text/html");
        const next = page.getElementById("sidebar-panel");
        if (!next) throw new Error("Invalid sidebar response");
        panel.innerHTML = next.innerHTML;
        const nextConfig = page.getElementById("sidebar-config");
        if (nextConfig) {
            config.dataset.token = nextConfig.dataset.token;
            currentKey = nextConfig.dataset.contextId;
        } else {
            currentKey = "";
            const retry = document.createElement("button");
            retry.textContent = "Retry loading customer";
            retry.addEventListener("click", () => {
                if (latestContext) void updateContext(latestContext);
            });
            panel.append(retry);
        }
    } catch {
        if (ownRevision !== revision) return;
        currentKey = "";
        message(
            "Could not load billing details. Reload this sidebar and try again.",
        );
    }
}

async function updateContext(context) {
    clearTimeout(timeout);
    latestContext = context;
    const conversationId = context.conversation?.id;
    const customerId = context.customer?.id;
    const key = conversationId
        ? `conversation:${conversationId}`
        : customerId
          ? `customer:${customerId}`
          : "";
    if (key && key === currentKey) return;
    if (!key) {
        activeRequest?.abort();
        revision++;
        currentKey = "";
        message("Select a Help Scout customer to view their subscription.");
        return;
    }
    currentKey = key;
    message("Loading the customer from Help Scout…");
    const body = new URLSearchParams({ token: config.dataset.token });
    if (conversationId) body.set("conversationId", String(conversationId));
    else body.set("customerId", String(customerId));
    if (context.mailbox?.id) body.set("mailboxId", String(context.mailbox.id));
    await load("/helpscout/billing-sidebar/context", body);
}

document.addEventListener("change", (event) => {
    if (
        event.target instanceof HTMLSelectElement &&
        event.target.id === "reason"
    ) {
        const details = document.getElementById("other-details");
        const other = document.getElementById("other");
        const show = event.target.value === "Other";
        if (details) details.hidden = !show;
        if (other instanceof HTMLTextAreaElement) other.disabled = !show;
    }

    if (event.target.name === "wouldHaveStayedIfOffered") {
        const first = event.target.form.querySelector(
            'input[name="wouldHaveStayedIfOffered"]',
        );
        first?.setCustomValidity("");
    }
});
document.addEventListener("submit", (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || !panel.contains(form)) return;
    event.preventDefault();
    const answers = form.querySelectorAll(
        'input[name="wouldHaveStayedIfOffered"]',
    );
    if (answers.length)
        answers[0].setCustomValidity(
            [...answers].some((input) => input.checked)
                ? ""
                : "Select at least one retention answer.",
        );
    if (!form.reportValidity()) return;
    const body = new URLSearchParams();
    new FormData(form).forEach((value, name) => {
        if (typeof value === "string") body.append(name, value);
    });
    void load(form.action, body);
});

void (async () => {
    try {
        const { default: HelpScout } =
            await import("https://esm.sh/@helpscout/javascript-sdk@0.10.0");
        // Help Scout owns scrolling; keep the iframe tall enough for expanded forms.
        let lastHeight = 0;
        const resize = new ResizeObserver(() => {
            const height = Math.ceil(
                document.body.getBoundingClientRect().height,
            );
            if (height !== lastHeight) {
                lastHeight = height;
                HelpScout.setAppHeight(height);
            }
        });
        resize.observe(document.body);
        window.addEventListener("pagehide", () => resize.disconnect(), {
            once: true,
        });
        HelpScout.watchApplicationContext((context) => {
            void updateContext(context);
        });
        await HelpScout.getApplicationContext().then(updateContext);
    } catch {
        clearTimeout(timeout);
        message("Could not read the Help Scout customer. Reload this sidebar.");
    }
})();
