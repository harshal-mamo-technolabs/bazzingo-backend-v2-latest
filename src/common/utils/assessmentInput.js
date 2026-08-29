const mongoose = require("mongoose");
const createHttpError = require("http-errors");
const { ASSESSMENT_MESSAGES } = require("../../constants");

const normalizeImageDescription = (raw) =>
    raw == null || (typeof raw === "string" && raw.trim() === "")
        ? null
        : String(raw).trim();

const parseQuickAssessmentIds = (value) => {
    if (value == null) {
        return [];
    }

    if (!Array.isArray(value)) {
        throw createHttpError(400, ASSESSMENT_MESSAGES.QUICK_IDS_NOT_ARRAY);
    }

    for (const raw of value) {
        if (!mongoose.isValidObjectId(raw)) {
            throw createHttpError(400, ASSESSMENT_MESSAGES.QUICK_IDS_INVALID);
        }
    }

    return value.map((id) => String(id));
};

const normalizeOptionScores = (raw) => {
    if (raw === undefined) {
        return undefined;
    }

    if (!Array.isArray(raw) || raw.length === 0) {
        throw createHttpError(400, ASSESSMENT_MESSAGES.OPTION_SCORES_EMPTY);
    }

    return raw.map((value, index) => {
        const parsed = Number(value);

        if (!Number.isFinite(parsed)) {
            throw createHttpError(
                400,
                `optionScores[${index}] must be a number`,
            );
        }

        return parsed;
    });
};

const deriveFirstName = (user) => {
    if (!user) {
        return "";
    }

    if (user.firstName && String(user.firstName).trim()) {
        return String(user.firstName).trim();
    }

    const full = user.name ? String(user.name).trim() : "";

    return full ? full.split(/\s+/)[0] || "" : "";
};

const shapeUserInfo = (user) => ({
    firstName: deriveFirstName(user),
    age:
        user &&
        user.age !== undefined &&
        user.age !== null &&
        String(user.age).trim() !== ""
            ? String(user.age)
            : "",
    country: user && user.country != null ? String(user.country) : "",
});

module.exports = {
    normalizeImageDescription,
    parseQuickAssessmentIds,
    normalizeOptionScores,
    deriveFirstName,
    shapeUserInfo,
};
