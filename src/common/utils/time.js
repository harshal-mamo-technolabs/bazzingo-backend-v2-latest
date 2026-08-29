const CET_TIME_ZONE = "Europe/Berlin";

const cetDateFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: CET_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
});

const getCETMidnight = (date = new Date()) =>
    new Date(Date.parse(`${cetDateFormatter.format(date)}T00:00:00Z`));

const getStartOfWeek = (now = new Date()) => {
    const reference = new Date(now);
    const day = reference.getDay();
    const diff = reference.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(reference.setDate(diff));

    monday.setHours(0, 0, 0, 0);

    return monday;
};

const getEndOfWeek = (now = new Date()) => {
    const monday = getStartOfWeek(now);
    const sunday = new Date(monday);

    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);

    return sunday;
};

module.exports = { getCETMidnight, getStartOfWeek, getEndOfWeek };
