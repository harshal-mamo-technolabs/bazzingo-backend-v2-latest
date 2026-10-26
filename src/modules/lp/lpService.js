const {
    LP_PROGRAM_SCORE,
    LP_USER_UTM_FIELDS,
    LP_SELECT,
} = require("../../constants");
const { getAssessmentAgeGroup } = require("../assessment/assessmentService");
const AssessmentScore = require("../assessment/assessmentScoreModel");
const User = require("../user/userModel");
const {
    hasRealUtm,
    realUtmValue,
    parseUtmParams,
    persistUtmDefaults,
} = require("../../common/utils/utmParams");
const LandingPageHook = require("./landingPageHookModel");

class LpService {
    constructor(logger) {
        this.logger = logger;
    }

    async findHookByUuid(uuid) {
        this.logger.info("Reading a landing page hook", { uuid });

        const hook = await LandingPageHook.findOne({ uuid });
        if (hook) await persistUtmDefaults(hook);
        return hook;
    }

    async createHook(fields) {
        this.logger.info("Creating a landing page hook", {
            uuid: fields.uuid,
        });

        const user = fields.email
            ? await this.findUserByEmail(fields.email)
            : null;
        return await LandingPageHook.create({
            ...fields,
            ...(user ? parseUtmParams(user) : {}),
        });
    }

    async saveHook(hook) {
        this.logger.info("Saving a landing page hook", { uuid: hook.uuid });

        await persistUtmDefaults(hook);
        return await hook.save();
    }

    async findUserById(userId) {
        return await User.findById(userId);
    }

    async findUserByEmail(email) {
        const user = await User.findOne({ email: String(email).toLowerCase() });
        if (user) await persistUtmDefaults(user);
        return user;
    }

    async markAssessmentSubmitted(user) {
        if (user.isAssessmentSubmited) {
            return user;
        }

        this.logger.info("Marking the user as having submitted an assessment", {
            userId: String(user._id),
        });

        user.isAssessmentSubmited = true;

        return await user.save();
    }

    async backfillUserUtmFromHook(hook) {
        try {
            if (
                !hook ||
                !hook.email ||
                (!hasRealUtm(hook) &&
                    realUtmValue(hook.utmEmail) === null &&
                    !hook.flowId)
            ) {
                return;
            }

            const user = await this.findUserByEmail(hook.email);

            if (!user) {
                return;
            }

            let changed = false;

            for (const field of LP_USER_UTM_FIELDS) {
                const real = realUtmValue(hook[field]);

                if (
                    real !== null &&
                    (realUtmValue(user[field]) === null ||
                        (field === "flowId" && user.flowId !== real))
                ) {
                    user[field] = real;
                    changed = true;
                }
            }

            if (changed) {
                await user.save();

                this.logger.info("Backfilled the user UTM from a hook", {
                    userId: String(user._id),
                    uuid: hook.uuid,
                });
            }
        } catch (err) {
            this.logger.error("Failed to backfill the user UTM from a hook", {
                uuid: hook?.uuid,
                message: err.message,
                stack: err.stack,
            });
        }
    }

    async findAgeGroupScores(ageGroup, mainCategory) {
        const scores = await AssessmentScore.find({ date: { $exists: true } })
            .populate({
                path: "userId",
                select: LP_SELECT.AGE,
                match: { age: { $exists: true } },
            })
            .lean();

        return scores.filter(
            (score) =>
                score.userId &&
                score.userId.age &&
                getAssessmentAgeGroup(score.userId.age) === ageGroup &&
                score.mainCategory === mainCategory,
        );
    }

    calculateProgramScore(assessmentScore, ageGroupScores) {
        if (ageGroupScores.length < LP_PROGRAM_SCORE.SAMPLE_THRESHOLD) {
            return Math.round(
                LP_PROGRAM_SCORE.BASE_OFFSET +
                    (assessmentScore / LP_PROGRAM_SCORE.BASE_DIVISOR) *
                        LP_PROGRAM_SCORE.BASE_RANGE,
            );
        }

        const scores = ageGroupScores.map((score) => score.totalScore);
        const average =
            scores.reduce((sum, score) => sum + score, 0) / scores.length;
        const variance =
            scores.reduce(
                (sum, score) => sum + Math.pow(score - average, 2),
                0,
            ) / scores.length;
        const spread = Math.sqrt(variance);

        if (spread === 0) {
            return LP_PROGRAM_SCORE.MEAN;
        }

        const programScore =
            LP_PROGRAM_SCORE.MEAN +
            LP_PROGRAM_SCORE.STANDARD_DEVIATION *
                ((assessmentScore - average) / spread);

        return Math.round(
            Math.max(
                LP_PROGRAM_SCORE.MIN,
                Math.min(LP_PROGRAM_SCORE.MAX, programScore),
            ),
        );
    }
}

module.exports = { LpService };
