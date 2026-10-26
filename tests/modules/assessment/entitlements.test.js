const { unusedPurchaseIds } = require("../../../src/common/utils/entitlements");

const ids = (set) => [...set].sort();

// Production user 694241ad8f830e7a9c27f70b: 7 succeeded EUR10 orders over 4
// distinct iq-test assessments, 4 completed. Three repeat purchases were
// being swallowed, so the page kept asking them to pay again.
const A = "68c171eed19c604df1688bb1";
const B = "6a0173a997f455666bc4a160";
const C = "68c173a5cbccbb57659ec2d0";
const D = "6a0171f297f455666bc4a15f";

const cases = [
    {
        name: "repeat purchase after completing grants another run",
        purchased: [A, A, B, B, C, C, D],
        completed: [A, B, C, D],
        expect: [A, B, C].sort(),
    },
    {
        name: "single purchase, not yet taken, is playable",
        purchased: [A],
        completed: [],
        expect: [A],
    },
    {
        name: "single purchase already taken is spent",
        purchased: [A],
        completed: [A],
        expect: [],
    },
    {
        name: "three purchases, one completion, still entitled",
        purchased: [A, A, A],
        completed: [A],
        expect: [A],
    },
    {
        name: "nothing purchased entitles nothing",
        purchased: [],
        completed: [A, B],
        expect: [],
    },
    {
        name: "completion without a purchase does not go negative",
        purchased: [B],
        completed: [A, B],
        expect: [],
    },
];

let failed = 0;

for (const c of cases) {
    const got = ids(unusedPurchaseIds(c.purchased, new Set(c.completed)));
    const ok = JSON.stringify(got) === JSON.stringify(c.expect);
    if (!ok) {
        failed++;
        console.error(`FAIL ${c.name}\n  expected ${JSON.stringify(c.expect)}\n  got      ${JSON.stringify(got)}`);
    }
}

// Accepts an array for completedIds too, not just a Set.
if (ids(unusedPurchaseIds([A, A], [A])).join() !== A) {
    failed++;
    console.error("FAIL array completedIds not handled");
}

if (failed) process.exit(1);
console.log(`entitlements: ${cases.length + 1} assertions passed`);
