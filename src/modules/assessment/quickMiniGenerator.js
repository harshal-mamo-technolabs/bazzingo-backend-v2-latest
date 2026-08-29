const createHttpError = require("http-errors");
const {
    FULL_ASSESSMENT_MESSAGES,
    ASSESSMENT_DEFAULTS,
} = require("../../constants");
const FullAssessment = require("./fullAssessmentModel");
const QuestionAndAnswer = require("./questionAndAnswerModel");
const QuickMiniAssessment = require("./quickMiniAssessmentModel");

const shuffleInPlace = (items) => {
    for (let i = items.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [items[i], items[j]] = [items[j], items[i]];
    }

    return items;
};

const generateQuickMinis = async ({
    fullAssessmentId,
    numberOfMinis = ASSESSMENT_DEFAULTS.QUICK_MINIS,
    miniSize = ASSESSMENT_DEFAULTS.MINI_SIZE,
}) => {
    const full = await FullAssessment.findById(fullAssessmentId).lean();

    if (!full) {
        throw createHttpError(404, FULL_ASSESSMENT_MESSAGES.NOT_FOUND);
    }

    const subcats = (full.subcategories || []).map(String);

    if (subcats.length === 0) {
        throw createHttpError(400, FULL_ASSESSMENT_MESSAGES.NO_SUBCATEGORIES);
    }

    const allQuestions = await QuestionAndAnswer.find({
        fullAssessment: fullAssessmentId,
    })
        .select("_id subcategory")
        .lean();

    if (allQuestions.length === 0) {
        throw createHttpError(400, FULL_ASSESSMENT_MESSAGES.NO_QUESTIONS);
    }

    const bySub = new Map(subcats.map((sub) => [sub, []]));

    for (const question of allQuestions) {
        const key = String(question.subcategory);

        if (!bySub.has(key)) {
            bySub.set(key, []);
        }

        bySub.get(key).push(question._id);
    }

    for (const questions of bySub.values()) {
        shuffleInPlace(questions);
    }

    const lastMini = await QuickMiniAssessment.findOne({
        fullAssessment: fullAssessmentId,
    })
        .sort({ order: -1 })
        .select("order")
        .lean();

    const startOrder = (lastMini?.order || 0) + 1;
    const createdIds = [];
    const breakdown = [];
    const usedQuestions = new Set();
    const ptrUnused = new Map();
    const ptrReuse = new Map();

    for (const sub of bySub.keys()) {
        ptrUnused.set(sub, 0);
        ptrReuse.set(sub, 0);
    }

    const takeFromSub = (subcat, wanted, miniChosenSet, allowReuse = false) => {
        const taken = [];
        const arr = bySub.get(subcat) || [];
        let takeCount = wanted;
        let pointer = ptrUnused.get(subcat) || 0;

        while (takeCount > 0 && pointer < arr.length) {
            const id = arr[pointer];
            pointer += 1;

            if (
                !usedQuestions.has(String(id)) &&
                !miniChosenSet.has(String(id))
            ) {
                taken.push(id);
                miniChosenSet.add(String(id));
                usedQuestions.add(String(id));
                takeCount -= 1;
            }
        }

        ptrUnused.set(subcat, pointer);

        if (allowReuse && takeCount > 0 && arr.length > 0) {
            let reusePointer = ptrReuse.get(subcat) || 0;
            let safety = arr.length * 2;

            while (takeCount > 0 && safety > 0) {
                safety -= 1;
                const id = arr[reusePointer % arr.length];
                reusePointer += 1;

                if (!miniChosenSet.has(String(id))) {
                    taken.push(id);
                    miniChosenSet.add(String(id));
                    takeCount -= 1;
                }
            }

            ptrReuse.set(subcat, reusePointer % Math.max(1, arr.length));
        }

        return taken;
    };

    for (let miniIndex = 0; miniIndex < numberOfMinis; miniIndex += 1) {
        const picked = [];
        const perSubPicked = {};
        const miniChosenSet = new Set();
        const subCount = subcats.length;
        const base = Math.floor(miniSize / subCount);
        const remainder = miniSize % subCount;

        for (const subcat of subcats) {
            const take = takeFromSub(subcat, base, miniChosenSet, false);
            picked.push(...take);
            perSubPicked[subcat] = (perSubPicked[subcat] || 0) + take.length;
        }

        const order = [
            ...subcats.slice(miniIndex % subCount),
            ...subcats.slice(0, miniIndex % subCount),
        ];

        for (let i = 0; i < remainder; i += 1) {
            const subcat = order[i % subCount];
            const take = takeFromSub(subcat, 1, miniChosenSet, false);

            if (take.length === 0) {
                const reuseTake = takeFromSub(subcat, 1, miniChosenSet, true);
                picked.push(...reuseTake);
                perSubPicked[subcat] =
                    (perSubPicked[subcat] || 0) + reuseTake.length;
            } else {
                picked.push(...take);
                perSubPicked[subcat] =
                    (perSubPicked[subcat] || 0) + take.length;
            }
        }

        let attempts = 0;

        while (picked.length < miniSize && attempts < subCount * miniSize) {
            const anyUnused = subcats.some(
                (sub) =>
                    (ptrUnused.get(sub) || 0) < (bySub.get(sub) || []).length,
            );

            let progressed = false;

            for (const sub of order) {
                if (picked.length >= miniSize) {
                    break;
                }

                const take = takeFromSub(sub, 1, miniChosenSet, !anyUnused);

                if (take.length > 0) {
                    picked.push(take[0]);
                    perSubPicked[sub] = (perSubPicked[sub] || 0) + 1;
                    progressed = true;
                }
            }

            if (!progressed) {
                break;
            }

            attempts += 1;
        }

        const mini = await QuickMiniAssessment.create({
            fullAssessment: fullAssessmentId,
            questions: picked,
            size: picked.length,
            order: startOrder + miniIndex,
        });

        await QuestionAndAnswer.updateMany(
            { _id: { $in: picked } },
            { $addToSet: { quickAssessment: mini._id } },
        );

        createdIds.push(mini._id);
        breakdown.push({
            order: startOrder + miniIndex,
            total: picked.length,
            perSubPicked,
        });
    }

    return { createdCount: createdIds.length, quickIds: createdIds, breakdown };
};

module.exports = { generateQuickMinis, shuffleInPlace };
