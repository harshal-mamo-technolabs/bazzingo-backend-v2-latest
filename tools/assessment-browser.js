/**
 * Dumps every assessment + its questions/answers into a self-contained
 * tools/assessments.html you can open in a browser.
 *
 *   NODE_ENV=development node tools/assessment-browser.js
 *
 * Add --serve to run it as a local page instead of a file dump. That mode
 * reads live from the DB and enables the delete button (which drops the
 * assessment plus its questions/minis), so it never touches the public API.
 *
 *   NODE_ENV=development node tools/assessment-browser.js --serve
 */
const fs = require("fs");
const http = require("http");
const path = require("path");
const mongoose = require("mongoose");
const { connectDb, disconnectDb } = require("../src/config/db");
const logger = require("../src/config/logger");
const { config } = require("../src/config");

const FullAssessment = require("../src/modules/assessment/fullAssessmentModel");
const QuestionAndAnswer = require("../src/modules/assessment/questionAndAnswerModel");
const QuickMiniAssessment = require("../src/modules/assessment/quickMiniAssessmentModel");
const DailyQuickAssignment = require("../src/modules/assessment/userQuickAssignmentModel");
const DailyChallenge = require("../src/modules/game/dailyChallengeModel");
const User = require("../src/modules/user/userModel");
const { assignDailyChallenge } = require("../src/jobs/dailyChallengeJob");
const AdhdAssessment = require("../src/modules/adhd-assessment/adhdAssessmentModel");
const AdhdQuestionAndAnswer = require("../src/modules/adhd-assessment/adhdQuestionAndAnswerModel");
const EiAssessment = require("../src/modules/ei-assessment/emotionalIntelligenceAssessmentModel");
const EiQuestionAndAnswer = require("../src/modules/ei-assessment/emotionalIntelligenceQuestionAndAnswerModel");

const out = path.join(__dirname, "assessments.html");
const templatePath = path.join(__dirname, "assessments.template.html");

// Question images are stored as frontend-relative paths (/iq-test/1.png),
// so point the page at the frontend's public dir.
const publicDir = path.resolve(
    process.env.FRONTEND_PUBLIC ||
        path.resolve(__dirname, "../../bazzingo-frontend/public"),
);

const group = (rows, key) =>
    rows.reduce((acc, row) => {
        const id = String(row[key]);
        (acc[id] = acc[id] || []).push(row);
        return acc;
    }, {});

const collect = async () => {
    const [fulls, fullQs, minis, adhds, adhdQs, eis, eiQs] = await Promise.all([
        FullAssessment.find().lean(),
        QuestionAndAnswer.find().lean(),
        QuickMiniAssessment.find().sort({ order: 1 }).lean(),
        AdhdAssessment.find().lean(),
        AdhdQuestionAndAnswer.find().lean(),
        EiAssessment.find().lean(),
        EiQuestionAndAnswer.find().lean(),
    ]);

    const byFull = group(fullQs, "fullAssessment");
    const minisByFull = group(minis, "fullAssessment");
    const byAdhd = group(adhdQs, "adhdAssessmentId");
    const byEi = group(eiQs, "emotionalIntelligenceAssessmentId");

    return [
        ...fulls.map((a) => ({
            id: String(a._id),
            type: "Cognitive",
            title: a.title || a.mainCategory,
            description: a.description,
            subcategories: a.subcategories || [],
            active: a.active,
            expected: a.questions,
            minis: (minisByFull[String(a._id)] || []).map((m) => ({
                id: String(m._id),
                order: m.order,
                size: m.size,
                isActive: m.isActive,
                questionIds: (m.questions || []).map(String),
            })),
            questions: (byFull[String(a._id)] || []).map((q) => ({
                id: String(q._id),
                subcategory: q.subcategory,
                questionType: q.questionType,
                imageQuestionDescription: q.imageQuestionDescription,
                question: q.question,
                optionsType: q.optionsType,
                options: q.options,
                answerIndex: q.answerIndex,
                points: q.points,
            })),
        })),
        ...adhds.map((a) => ({
            id: String(a._id),
            type: "ADHD",
            title: a.title || "ADHD Assessment",
            description: a.description,
            subcategories: a.subCategories || [],
            active: a.active,
            expected: a.questions,
            minis: [],
            questions: (byAdhd[String(a._id)] || []).map((q) => ({
                id: String(q._id),
                subcategory: q.subCategory,
                questionType: q.questionType,
                imageQuestionDescription: q.imageQuestionDescription,
                question: q.question,
                optionScores: q.optionScores,
                isReverseScored: q.isReverseScored,
            })),
        })),
        ...eis.map((a) => ({
            id: String(a._id),
            type: "Emotional Intelligence",
            title: a.title || "Emotional Intelligence Assessment",
            description: a.description,
            subcategories: a.subCategories || [],
            active: a.active,
            expected: a.questions,
            minis: [],
            questions: (byEi[String(a._id)] || []).map((q) => ({
                id: String(q._id),
                subcategory: q.subCategory,
                questionType: q.questionType,
                imageQuestionDescription: q.imageQuestionDescription,
                question: q.question,
                optionScores: q.optionScores,
                isReverseScored: q.isReverseScored,
            })),
        })),
    ];
};

const render = (assessments, { imageBase, canDelete }) =>
    fs.readFileSync(templatePath, "utf8").replace(
        // Tolerates prettier reformatting the placeholder to "/*__DATA__*/ null".
        /\/\*__DATA__\*\/\s*null/,
        () =>
            JSON.stringify({
                generatedAt: new Date().toISOString(),
                imageBase,
                canDelete,
                env: config.NODE_ENV,
                dbHost: mongoose.connection.host,
                apiBase: (
                    process.env.API_BASE ||
                    `http://localhost:${process.env.PORT || 8000}`
                ).replace(/\/$/, ""),
                assessments,
            }).replace(/</g, "\\u003c"),
    );

const summary = (assessments) =>
    `${assessments.length} assessments, ${assessments.reduce((n, a) => n + a.questions.length, 0)} questions, ${assessments.reduce((n, a) => n + a.minis.length, 0)} mini assessments`;

/**
 * Drops the assessment plus everything that only exists because of it: its
 * questions, every quick mini built from it, and the daily assignments /
 * daily challenge pointing at those minis — today's included. Scores, orders
 * and landing-page leads are history, so they stay.
 */
const remove = async (id) => {
    if (!mongoose.isValidObjectId(id)) {
        return null;
    }

    if (await FullAssessment.findByIdAndDelete(id)) {
        const miniIds = await QuickMiniAssessment.distinct("_id", {
            fullAssessment: id,
        });

        const [questions, minis, assignments, challenges, users] =
            await Promise.all([
                QuestionAndAnswer.deleteMany({ fullAssessment: id }),
                QuickMiniAssessment.deleteMany({ fullAssessment: id }),
                DailyQuickAssignment.deleteMany({
                    quickAssessmentId: { $in: miniIds },
                }),
                DailyChallenge.deleteMany({
                    quickAssessmentId: { $in: miniIds },
                }),
                User.updateMany(
                    { quickMiniAssessmntId: { $in: miniIds } },
                    { $unset: { quickMiniAssessmntId: "" } },
                ),
            ]);

        // Today's challenge may have just been deleted with it; the job only
        // creates a missing one, so this rebuilds it from the surviving minis.
        const rebuilt = challenges.deletedCount
            ? await assignDailyChallenge(logger)
            : null;

        return `Cognitive — ${questions.deletedCount} questions, ${minis.deletedCount} minis, ${assignments.deletedCount} daily assignments, ${challenges.deletedCount} daily challenges${rebuilt ? " (today's rebuilt)" : ""}, ${users.modifiedCount} users unlinked`;
    }

    if (await AdhdAssessment.findByIdAndDelete(id)) {
        const { deletedCount } = await AdhdQuestionAndAnswer.deleteMany({
            adhdAssessmentId: id,
        });

        return `ADHD — ${deletedCount} questions`;
    }

    if (await EiAssessment.findByIdAndDelete(id)) {
        const { deletedCount } = await EiQuestionAndAnswer.deleteMany({
            emotionalIntelligenceAssessmentId: id,
        });

        return `Emotional Intelligence — ${deletedCount} questions`;
    }

    return null;
};

const MIME = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
};

const serveAsset = (req, res) => {
    const file = path.join(
        publicDir,
        decodeURIComponent(req.url.slice("/public/".length)),
    );

    if (!file.startsWith(publicDir + path.sep) || !fs.existsSync(file)) {
        res.writeHead(404).end("not found");
        return;
    }

    res.writeHead(200, {
        "content-type":
            MIME[path.extname(file).toLowerCase()] ||
            "application/octet-stream",
    });
    fs.createReadStream(file).pipe(res);
};

const serve = async () => {
    const port = Number(process.env.TOOL_PORT || 4173);

    const server = http.createServer(async (req, res) => {
        try {
            const [, root, id] = req.url.split("?")[0].split("/");

            if (req.method === "DELETE" && root === "a") {
                const result = await remove(id);
                const message = result
                    ? `Deleted ${result}`
                    : `No assessment ${id}`;

                res.writeHead(result ? 200 : 404, {
                    "content-type": "text/plain",
                });
                res.end(message);
                console.log(message);
                return;
            }

            if (req.url.startsWith("/public/")) {
                return serveAsset(req, res);
            }

            res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
            res.end(
                render(await collect(), {
                    imageBase: "/public",
                    canDelete: true,
                }),
            );
        } catch (error) {
            console.error(error);
            res.writeHead(500, { "content-type": "text/plain" });
            res.end(String(error.message));
        }
    });

    server.listen(port, () =>
        console.log(
            `Assessment browser (delete enabled) http://localhost:${port}`,
        ),
    );
};

const dump = async () => {
    const assessments = await collect();
    const imageBase = fs.existsSync(publicDir)
        ? encodeURI(path.relative(path.dirname(out), publicDir))
        : "";

    if (!imageBase) {
        console.warn(
            `Frontend public dir not found at ${publicDir} — images will show as paths. Set FRONTEND_PUBLIC=/path/to/public`,
        );
    }

    fs.writeFileSync(out, render(assessments, { imageBase, canDelete: false }));

    await disconnectDb();

    console.log(`${summary(assessments)} -> ${out}`);
};

if (require.main === module) {
    connectDb()
        .then(() => (process.argv.includes("--serve") ? serve() : dump()))
        .catch((error) => {
            console.error(error);
            process.exit(1);
        });
}

module.exports = { collect, remove };
