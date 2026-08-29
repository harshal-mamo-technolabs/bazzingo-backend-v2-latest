const nodemailer = require("nodemailer");
const { config } = require("../../config");

const sendEmail = async ({ email, subject, message, html }) => {
    const transporter = nodemailer.createTransport({
        host: config.EMAIL_HOST,
        port: config.EMAIL_PORT,
        secure: String(config.EMAIL_PORT) === "465",
        auth: { user: config.EMAIL_USER, pass: config.EMAIL_PASS },
    });

    await transporter.sendMail({
        from: `"${config.EMAIL_FROM_NAME}" <${config.EMAIL_USER}>`,
        to: email,
        subject,
        text: message,
        ...(html ? { html } : {}),
    });
};

module.exports = { sendEmail };
