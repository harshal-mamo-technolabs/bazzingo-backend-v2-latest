const {
    ORDER_STATUSES,
    STRIPE_WEBHOOK_EVENTS,
    STRIPE_MESSAGES,
    STRIPE_MESSAGE_BUILDERS,
} = require("../../constants");
const { isElementsFlow } = require("./stripeService");

class StripeWebhookController {
    constructor(stripeService, logger, stripe, webhookSecret, verifySignature) {
        this.stripeService = stripeService;
        this.logger = logger;
        this.stripe = stripe;
        this.webhookSecret = webhookSecret;
        this.verifySignature =
            verifySignature ??
            ((payload, signature, secret) =>
                this.stripe.webhooks.constructEvent(
                    payload,
                    signature,
                    secret,
                ));
    }

    async webhook(req, res) {
        const signature = req.headers["stripe-signature"];

        this.logger.info("Incoming stripe webhook", {
            requestId: req.requestId,
        });

        if (!this.webhookSecret) {
            this.logger.error("Stripe webhook secret is not configured", {
                requestId: req.requestId,
            });

            return res
                .status(500)
                .send(STRIPE_MESSAGES.WEBHOOK_SECRET_NOT_CONFIGURED);
        }

        if (!this.stripe) {
            this.logger.error("Stripe client is not configured", {
                requestId: req.requestId,
            });

            return res
                .status(500)
                .send(STRIPE_MESSAGES.WEBHOOK_STRIPE_NOT_CONFIGURED);
        }

        let event;

        try {
            const payload = Buffer.isBuffer(req.body)
                ? req.body
                : req.rawBody || null;

            if (!payload) {
                throw new Error(STRIPE_MESSAGES.WEBHOOK_NO_PAYLOAD);
            }

            event = this.verifySignature(
                payload,
                signature,
                this.webhookSecret,
            );
        } catch (error) {
            this.logger.warn("Stripe webhook signature verification failed", {
                requestId: req.requestId,
                reason: error.message,
            });

            return res
                .status(400)
                .send(STRIPE_MESSAGE_BUILDERS.webhookError(error.message));
        }

        try {
            await this.dispatch(event);
        } catch (error) {
            this.logger.error("Stripe webhook handler failed", {
                requestId: req.requestId,
                eventType: event.type,
                reason: error.message,
            });

            return res.status(500).send(STRIPE_MESSAGES.WEBHOOK_HANDLER_FAILED);
        }

        this.logger.info("Stripe webhook handled", {
            requestId: req.requestId,
            eventType: event.type,
        });

        return res.json({ received: true });
    }

    async dispatch(event) {
        const object = event.data.object;

        switch (event.type) {
            case STRIPE_WEBHOOK_EVENTS.CHECKOUT_SESSION_COMPLETED:
                return await this.stripeService.handleCheckoutSessionCompleted(
                    object,
                );

            case STRIPE_WEBHOOK_EVENTS.PAYMENT_INTENT_SUCCEEDED:
                return await this.stripeService.handlePaymentIntentSucceeded(
                    object,
                );

            case STRIPE_WEBHOOK_EVENTS.PAYMENT_INTENT_PAYMENT_FAILED:
                return await this.stripeService.setOrderStatus({
                    filter: { stripePaymentIntentId: object.id },
                    status: ORDER_STATUSES.FAILED,
                });

            case STRIPE_WEBHOOK_EVENTS.CHECKOUT_SESSION_ASYNC_PAYMENT_SUCCEEDED:
                return await this.stripeService.handleAsyncPaymentSucceeded(
                    object,
                );

            case STRIPE_WEBHOOK_EVENTS.CHECKOUT_SESSION_ASYNC_PAYMENT_FAILED:
                return await this.stripeService.setOrderStatus({
                    filter: { stripeSessionId: object.id },
                    status: ORDER_STATUSES.FAILED,
                });

            case STRIPE_WEBHOOK_EVENTS.CHECKOUT_SESSION_EXPIRED:
                return await this.stripeService.setOrderStatus({
                    filter: { stripeSessionId: object.id },
                    status: ORDER_STATUSES.CANCELED,
                });

            case STRIPE_WEBHOOK_EVENTS.CUSTOMER_SUBSCRIPTION_CREATED:
                return isElementsFlow(object.metadata)
                    ? await this.stripeService.handleElementsSubscriptionCreated(
                          object,
                      )
                    : await this.stripeService.handleSubscriptionCreated(
                          object,
                      );

            case STRIPE_WEBHOOK_EVENTS.CUSTOMER_SUBSCRIPTION_UPDATED:
                return isElementsFlow(object.metadata)
                    ? await this.stripeService.handleElementsSubscriptionUpdated(
                          object,
                      )
                    : await this.stripeService.handleSubscriptionUpdated(
                          object,
                      );

            case STRIPE_WEBHOOK_EVENTS.CUSTOMER_SUBSCRIPTION_DELETED:
                return isElementsFlow(object.metadata)
                    ? await this.stripeService.handleElementsSubscriptionDeleted(
                          object,
                      )
                    : await this.stripeService.handleSubscriptionDeleted(
                          object,
                      );

            case STRIPE_WEBHOOK_EVENTS.INVOICE_PAYMENT_SUCCEEDED:
                return await this.stripeService.handleInvoicePaymentSucceeded(
                    object,
                );

            case STRIPE_WEBHOOK_EVENTS.INVOICE_PAYMENT_FAILED:
                return await this.stripeService.handleInvoicePaymentFailed(
                    object,
                );

            case STRIPE_WEBHOOK_EVENTS.CUSTOMER_SUBSCRIPTION_TRIAL_WILL_END:
                return await this.stripeService.handleTrialWillEnd(object);

            case STRIPE_WEBHOOK_EVENTS.PAYMENT_METHOD_ATTACHED:
                return await this.stripeService.handlePaymentMethodAttached(
                    object,
                );

            case STRIPE_WEBHOOK_EVENTS.CHARGE_REFUNDED:
                return await this.stripeService.handleChargeRefunded(object);

            case STRIPE_WEBHOOK_EVENTS.INVOICE_PAID:
                return await this.stripeService.handleInvoicePaid(object);

            case STRIPE_WEBHOOK_EVENTS.CUSTOMER_DELETED:
                return await this.stripeService.handleCustomerDeleted(object);

            default:
                return undefined;
        }
    }
}

module.exports = { StripeWebhookController };
