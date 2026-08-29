const AGE_RANGES = [
    [0, 12],
    [13, 17],
    [18, 24],
    [25, 34],
    [35, 44],
    [45, 54],
    [55, 64],
    [65, 200],
];

const getAgeGroup = (age) => {
    if (!age || typeof age !== "number" || age < 0) {
        return undefined;
    }

    const range = AGE_RANGES.find(([min, max]) => age >= min && age <= max);

    return range ? `${range[0]}-${range[1]}` : undefined;
};

module.exports = { getAgeGroup, AGE_RANGES };
