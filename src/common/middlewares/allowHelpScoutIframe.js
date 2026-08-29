const { config } = require("../../config");
const { HELPSCOUT_DEFAULTS } = require("../../constants");

const applyHelpScoutIframeHeaders = (res) => {
    res.removeHeader("X-Frame-Options");
    res.setHeader(
        "Content-Security-Policy",
        `frame-ancestors ${config.HELP_SCOUT_FRAME_ANCESTORS}`,
    );
};

const allowHelpScoutIframe = (req, res, next) => {
    applyHelpScoutIframeHeaders(res);
    next();
};

module.exports = { allowHelpScoutIframe, applyHelpScoutIframeHeaders };
