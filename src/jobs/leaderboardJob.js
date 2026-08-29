const runLeaderboardRanksJob = async (logger, leaderboardService) => {
    logger.info("Recomputing the leaderboard ranks");

    try {
        await leaderboardService.recomputeRanks();

        logger.info("Leaderboard ranks updated");
    } catch (err) {
        logger.error("Leaderboard rank recompute failed", {
            message: err.message,
            stack: err.stack,
        });
    }
};

module.exports = { runLeaderboardRanksJob };
