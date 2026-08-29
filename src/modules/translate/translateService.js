const {
    TRANSLATE_API_URL,
    TRANSLATE_LIMITS,
    TRANSLATE_LANGUAGE_ALIASES,
    TRANSLATE_LANGUAGE_LABELS,
    TRANSLATE_LANGUAGE_CODE_PATTERN,
    TRANSLATE_MESSAGES,
} = require("../../constants");

class TranslateService {
    constructor(logger, translateClient, apiKey) {
        this.logger = logger;
        this.translateClient = translateClient;
        this.apiKey = apiKey;
        this.cache = new Map();
        this.queue = Promise.resolve();
        this.nextAvailableTime = 0;
    }

    normalizeText(text) {
        return text.trim().replace(/\s+/g, " ");
    }

    normalizeLanguageCode(languageCode, label) {
        if (!languageCode || typeof languageCode !== "string") {
            throw new Error(TRANSLATE_MESSAGES.LANGUAGE_REQUIRED(label));
        }

        const normalized = languageCode.trim().toLowerCase();

        if (!normalized) {
            throw new Error(TRANSLATE_MESSAGES.LANGUAGE_EMPTY(label));
        }

        const aliased = TRANSLATE_LANGUAGE_ALIASES[normalized] || normalized;

        if (!TRANSLATE_LANGUAGE_CODE_PATTERN.test(aliased)) {
            throw new Error(
                TRANSLATE_MESSAGES.LANGUAGE_INVALID(label, languageCode),
            );
        }

        return aliased.replace("_", "-");
    }

    cacheKey(text, sourceLang, targetLang) {
        return `${sourceLang}::${targetLang}::${this.normalizeText(text)}`;
    }

    getCachedTranslation(text, sourceLang, targetLang) {
        const key = this.cacheKey(text, sourceLang, targetLang);
        const entry = this.cache.get(key);

        if (!entry) {
            return null;
        }

        if (Date.now() - entry.timestamp > TRANSLATE_LIMITS.CACHE_TTL_MS) {
            this.cache.delete(key);
            return null;
        }

        return entry.value;
    }

    setCachedTranslation(text, sourceLang, targetLang, value) {
        if (this.cache.size >= TRANSLATE_LIMITS.MAX_CACHE_ENTRIES) {
            const oldestKey = this.cache.keys().next().value;

            if (oldestKey) {
                this.cache.delete(oldestKey);
            }
        }

        this.cache.set(this.cacheKey(text, sourceLang, targetLang), {
            value,
            timestamp: Date.now(),
        });
    }

    schedule(task) {
        const run = async () => {
            const now = Date.now();

            if (now < this.nextAvailableTime) {
                await new Promise((resolve) =>
                    setTimeout(resolve, this.nextAvailableTime - now),
                );
            }

            this.nextAvailableTime =
                Date.now() + TRANSLATE_LIMITS.MIN_INTERVAL_MS;

            return await task();
        };

        const result = this.queue.then(run, run);

        this.queue = result.then(
            () => undefined,
            () => undefined,
        );

        return result;
    }

    async requestTranslations(texts, sourceLang, targetLang) {
        return await this.schedule(async () => {
            this.logger.info("Calling the Google Translate API", {
                count: texts.length,
                sourceLang,
                targetLang,
            });

            const url = new URL(TRANSLATE_API_URL);
            url.searchParams.append("key", this.apiKey);

            const response = await this.translateClient(url.toString(), {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    q: texts,
                    source: sourceLang,
                    target: targetLang,
                    format: "text",
                }),
            });

            const data = await response.json();

            if (!response.ok || data.error) {
                const errorMessage =
                    data.error?.message ||
                    TRANSLATE_MESSAGES.REQUEST_FAILED(
                        response.status,
                        response.statusText,
                    );
                const errorCode = data.error?.code || response.status;

                this.logger.error("Google Translate API returned an error", {
                    status: response.status,
                    code: errorCode,
                    message: errorMessage,
                    count: texts.length,
                });

                if (
                    errorCode === 403 &&
                    errorMessage.toLowerCase().includes("rate limit")
                ) {
                    throw new Error(TRANSLATE_MESSAGES.RATE_LIMIT_EXCEEDED);
                }

                if (errorCode === 400) {
                    throw new Error(
                        TRANSLATE_MESSAGES.INVALID_REQUEST(errorMessage),
                    );
                }

                throw new Error(errorMessage);
            }

            if (!data.data?.translations?.length) {
                this.logger.error("Google Translate API returned no data", {
                    count: texts.length,
                });
                throw new Error(TRANSLATE_MESSAGES.NO_TRANSLATION);
            }

            const translations = data.data.translations.map(
                (translation) => translation.translatedText,
            );

            this.logger.info("Google Translate API request succeeded", {
                count: translations.length,
            });

            return translations;
        });
    }

    async translateTexts(texts, sourceLang, targetLang) {
        this.logger.info("Translating texts", {
            count: Array.isArray(texts) ? texts.length : null,
            sourceLang,
            targetLang,
            cacheSize: this.cache.size,
        });

        if (!this.apiKey) {
            this.logger.error("Google Translate API key is missing");
            throw new Error(TRANSLATE_MESSAGES.API_KEY_MISSING);
        }

        if (!Array.isArray(texts) || texts.length === 0) {
            this.logger.warn("Texts to translate were not a non-empty array");
            throw new Error(TRANSLATE_MESSAGES.TEXTS_NOT_ARRAY);
        }

        for (let i = 0; i < texts.length; i++) {
            if (typeof texts[i] !== "string") {
                this.logger.warn("A text to translate was not a string", {
                    index: i,
                });
                throw new Error(TRANSLATE_MESSAGES.TEXT_NOT_STRING(i));
            }
        }

        const source = this.normalizeLanguageCode(
            sourceLang,
            TRANSLATE_LANGUAGE_LABELS.SOURCE,
        );
        const target = this.normalizeLanguageCode(
            targetLang,
            TRANSLATE_LANGUAGE_LABELS.TARGET,
        );

        const results = new Array(texts.length);
        const pending = new Map();

        texts.forEach((text, index) => {
            const cached = this.getCachedTranslation(text, source, target);

            if (cached) {
                results[index] = cached;
                return;
            }

            const normalized = this.normalizeText(text);

            if (!pending.has(normalized)) {
                pending.set(normalized, { text, indices: [] });
            }

            pending.get(normalized).indices.push(index);
        });

        const entries = Array.from(pending.values());

        this.logger.info("Resolved the translation cache", {
            total: texts.length,
            cacheHits: texts.length - entries.length,
            toTranslate: entries.length,
        });

        for (
            let i = 0;
            i < entries.length;
            i += TRANSLATE_LIMITS.MAX_BATCH_SIZE
        ) {
            const batch = entries.slice(i, i + TRANSLATE_LIMITS.MAX_BATCH_SIZE);

            const translations = await this.requestTranslations(
                batch.map((entry) => entry.text),
                source,
                target,
            );

            translations.forEach((translatedText, index) => {
                const entry = batch[index];

                this.setCachedTranslation(
                    entry.text,
                    source,
                    target,
                    translatedText,
                );

                entry.indices.forEach((originalIndex) => {
                    results[originalIndex] = translatedText;
                });
            });
        }

        this.logger.info("Translation complete", {
            total: texts.length,
            fromApi: entries.length,
            cacheSize: this.cache.size,
        });

        return results;
    }
}

module.exports = { TranslateService };
