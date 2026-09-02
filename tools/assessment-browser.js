/**
 * Dumps every assessment + its questions/answers into a self-contained
 * tools/assessments.html you can open in a browser.
 *
 *   NODE_ENV=development node tools/assessment-browser.js
 */
const fs = require("fs");
const path = require("path");
const { connectDb, disconnectDb } = require("../src/config/db");

const FullAssessment = require("../src/modules/assessment/fullAssessmentModel");
const QuestionAndAnswer = require("../src/modules/assessment/questionAndAnswerModel");
const QuickMiniAssessment = require("../src/modules/assessment/quickMiniAssessmentModel");
const AdhdAssessment = require("../src/modules/adhd-assessment/adhdAssessmentModel");
const AdhdQuestionAndAnswer = require("../src/modules/adhd-assessment/adhdQuestionAndAnswerModel");
const EiAssessment = require("../src/modules/ei-assessment/emotionalIntelligenceAssessmentModel");
const EiQuestionAndAnswer = require("../src/modules/ei-assessment/emotionalIntelligenceQuestionAndAnswerModel");

const group = (rows, key) =>
    rows.reduce((acc, row) => {
        const id = String(row[key]);
        (acc[id] = acc[id] || []).push(row);
        return acc;
    }, {});

const build = async () => {
    await connectDb();

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

    const assessments = [
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

    await disconnectDb();

    const template = fs.readFileSync(
        path.join(__dirname, "assessments.template.html"),
        "utf8",
    );
    const out = path.join(__dirname, "assessments.html");

    // Question images are stored as frontend-relative paths (/iq-test/1.png),
    // so point the page at the frontend's public dir.
    const publicDir =
        process.env.FRONTEND_PUBLIC ||
        path.resolve(__dirname, "../../bazzingo-frontend/public");
    const imageBase = fs.existsSync(publicDir)
        ? encodeURI(path.relative(path.dirname(out), publicDir))
        : "";

    if (!imageBase) {
        console.warn(
            `Frontend public dir not found at ${publicDir} — images will show as paths. Set FRONTEND_PUBLIC=/path/to/public`,
        );
    }

    fs.writeFileSync(
        out,
        template.replace(
            "/*__DATA__*/null",
            JSON.stringify({
                generatedAt: new Date().toISOString(),
                imageBase,
                apiBase: (
                    process.env.API_BASE || `http://localhost:${process.env.PORT || 8000}`
                ).replace(/\/$/, ""),
                assessments,
            }).replace(/</g, "\\u003c"),
        ),
    );

    console.log(
        `${assessments.length} assessments, ${assessments.reduce((n, a) => n + a.questions.length, 0)} questions, ${minis.length} mini assessments -> ${out}`,
    );
};

build().catch((error) => {
    console.error(error);
    process.exit(1);
});
