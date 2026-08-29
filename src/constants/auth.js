const AUTH_TOKEN_EXPIRY = {
    SIGNUP: "365d",
    LANDING_PAGE: "30m",
    REFRESHED: "365d",
    LOGIN: "7d",
    PASSWORD_RESET: "5m",
};

const AVATAR_COUNT = 8;

const AUTH_ENDPOINT_MESSAGES = {
    REGISTERED: "User registered successfully",
    REGISTERED_MSISDN: "User registered successfully with MSISDN",
    LOGIN_SUCCESS: "Login successful",
    ASSESSMENT_SYNCED: "Assessment submission synced successfully",
    PASSWORD_RESET_SENT:
        "If the email is registered, a password reset link has been sent.",
    PASSWORD_RESET: "Password has been reset.",
    PASSWORD_UPDATED: "Password updated successfully",
    EMAIL_TAKEN: "User already exists with this email",
    MSISDN_TAKEN: "User already exists with this MSISDN",
    MSISDN_REQUIRED: "MSISDN is required",
    MSISDN_INVALID: "Invalid MSISDN",
    CREDENTIALS_REQUIRED: "Email and password are required",
    CREDENTIALS_INVALID: "Please enter correct email or password",
    GOOGLE_ACCOUNT:
        "This account was created with Google. Please use Google login instead.",
    ID_TOKEN_REQUIRED: "ID token is required",
    TOKEN_REQUIRED: "Token is required",
    TOKEN_INVALID: "Invalid or expired token",
    USER_NOT_FOUND: "User not found",
    EMAIL_REQUIRED: "Please provide an email",
    EMAIL_SEND_FAILED: "There was an error sending the email. Try again later.",
    PASSWORD_REQUIRED: "Password is required",
    RESET_TOKEN_INVALID: "Invalid token or user does not exist.",
    RESET_TOKEN_EXPIRED: "Token has expired.",
    RESET_TOKEN_BAD: "Invalid token.",
    PASSWORDS_REQUIRED: "Old and new passwords are required",
    OLD_PASSWORD_INVALID: "Old password is incorrect",
};

const AUTH_MESSAGE_BUILDERS = {
    passwordResetSubject: (platformName = "TestBrain") =>
        `Reset your ${platformName} password`,
    passwordResetText: (resetURL) =>
        `Forgot your password? Click the link below to choose a new one:\n\n${resetURL}\n\nThis link expires in 5 minutes. If you didn't request this, you can safely ignore this email.`,
    passwordResetHtml: (resetURL, platformName = "TestBrain") => `
        <div style="background-color:#F7F5F1;padding:40px 16px;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
          <div style="max-width:480px;margin:0 auto;background-color:#FFFFFF;border:1px solid #E8E3DB;border-radius:8px;overflow:hidden;">
            <div style="padding:32px 32px 0 32px;text-align:center;">
              <span style="display:inline-block;font-size:22px;font-weight:700;color:#163C3A;letter-spacing:-0.02em;">${platformName}</span>
            </div>
            <div style="padding:24px 32px 32px 32px;">
              <h1 style="margin:0 0 12px 0;font-size:22px;line-height:1.3;font-weight:700;color:#111827;text-align:center;">Reset your password</h1>
              <p style="margin:0 0 24px 0;font-size:15px;line-height:1.5;color:#64748B;text-align:center;">
                We received a request to reset your ${platformName} password. Click the button below to choose a new one. If you didn't request this, you can safely ignore this email.
              </p>
              <div style="text-align:center;margin-bottom:24px;">
                <a href="${resetURL}" style="display:inline-block;background-color:#163C3A;color:#FFFFFF;font-size:15px;font-weight:600;text-decoration:none;padding:14px 32px;border-radius:8px;">
                  Reset Password
                </a>
              </div>
              <p style="margin:0 0 8px 0;font-size:13px;line-height:1.5;color:#64748B;text-align:center;">
                Or copy and paste this link into your browser:
              </p>
              <p style="margin:0 0 24px 0;font-size:13px;line-height:1.5;text-align:center;word-break:break-all;">
                <a href="${resetURL}" style="color:#163C3A;">${resetURL}</a>
              </p>
              <p style="margin:0;font-size:12px;color:#94A3B8;text-align:center;">This link will expire in 5 minutes.</p>
            </div>
            <div style="background-color:#F7F5F1;padding:16px 32px;text-align:center;border-top:1px solid #E8E3DB;">
              <p style="margin:0;font-size:12px;color:#64748B;">&copy; ${new Date().getFullYear()} ${platformName}. All rights reserved.</p>
            </div>
          </div>
        </div>
        `,
};

const DUMMY_SUBSCRIPTION = {
    CREATED_BY: "dummy_signup",
    DURATION: "monthly",
    STATUS: "active",
    DEFAULT_CURRENCY: "EUR",
};

const TEN_YEAR_SUBSCRIPTION = {
    YEARS: 10,
    STATUS: "active",
    DURATION: "yearly",
    CURRENCY: "USD",
    SOURCE: "msisdn_signup",
};

module.exports = {
    AUTH_TOKEN_EXPIRY,
    AVATAR_COUNT,
    AUTH_ENDPOINT_MESSAGES,
    AUTH_MESSAGE_BUILDERS,
    DUMMY_SUBSCRIPTION,
    TEN_YEAR_SUBSCRIPTION,
};
