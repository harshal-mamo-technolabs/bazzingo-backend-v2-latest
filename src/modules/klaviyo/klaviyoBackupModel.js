const mongoose = require("mongoose");
const { Schema } = mongoose;

const KlaviyoBackupSchema = new Schema(
    {
        email: {
            type: String,
            required: true,
            unique: true,
            index: true,
            lowercase: true,
            trim: true,
        },
        firstName: { type: String, default: null },
        lastName: { type: String, default: null },

        properties: { type: Schema.Types.Mixed, default: {} },
    },
    { timestamps: true, collection: "klaviyo_backups" },
);

module.exports = mongoose.model("KlaviyoBackup", KlaviyoBackupSchema);
