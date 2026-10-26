/**
 * A succeeded order grants one run of an assessment.
 *
 * Entitlement used to be read as "an order exists and no score exists", but
 * AssessmentScore is unique per (userId, type, assessmentId), so that check
 * flips false forever the moment a user finishes an assessment. Every repeat
 * purchase of the same assessment was then invisible: the money was taken and
 * the user was asked to pay again. Counting purchases against completions
 * keeps a re-purchase playable.
 *
 * @param {string[]} purchasedIds assessment ids, one entry per succeeded order
 * @param {Set<string>|string[]} completedIds assessment ids the user submitted
 * @returns {Set<string>} ids with at least one unused purchase
 */
const unusedPurchaseIds = (purchasedIds, completedIds) => {
    const completed =
        completedIds instanceof Set ? completedIds : new Set(completedIds);

    const counts = new Map();

    for (const id of purchasedIds) {
        const key = String(id);
        counts.set(key, (counts.get(key) || 0) + 1);
    }

    const unused = new Set();

    for (const [id, purchases] of counts) {
        if (purchases > (completed.has(id) ? 1 : 0)) {
            unused.add(id);
        }
    }

    return unused;
};

module.exports = { unusedPurchaseIds };
