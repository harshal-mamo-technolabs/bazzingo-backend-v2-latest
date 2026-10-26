// A PaymentIntent cannot reference a Stripe price, so one-off purchases are
// billed as a single-line invoice for the catalog price. Stripe then records
// the product and price of the sale, and callers keep working with the
// invoice's PaymentIntent exactly as they did with a bare one.
const createPricePayment = async (
    stripe,
    { customerId, priceId, description, metadata, paymentMethodId },
) => {
    const invoice = await stripe.invoices.create({
        customer: customerId,
        collection_method: "charge_automatically",
        auto_advance: false,
        pending_invoice_items_behavior: "exclude",
        description,
        metadata,
        payment_settings: { payment_method_types: ["card"] },
    });

    await stripe.invoiceItems.create({
        customer: customerId,
        invoice: invoice.id,
        pricing: { price: priceId },
        metadata,
    });

    const finalized = await stripe.invoices.finalizeInvoice(invoice.id, {
        auto_advance: false,
        expand: ["payments"],
    });
    const paymentIntentId = finalized.payments?.data?.[0]?.payment?.payment_intent;

    // Webhooks and the confirm endpoints read our metadata off the PaymentIntent.
    const paymentIntent = await stripe.paymentIntents.update(paymentIntentId, {
        description,
        metadata,
        ...(paymentMethodId ? {} : { setup_future_usage: "off_session" }),
    });

    if (!paymentMethodId) {
        return paymentIntent;
    }

    try {
        await stripe.invoices.pay(invoice.id, {
            payment_method: paymentMethodId,
            off_session: true,
        });
    } catch (error) {
        const failed = await stripe.paymentIntents.retrieve(paymentIntentId);

        if (failed.status !== "requires_action") {
            await stripe.invoices.voidInvoice(invoice.id).catch(() => {});
        }

        // Same shape as a failed off-session paymentIntents.create, so the
        // callers' 3-D Secure handling keeps working.
        error.payment_intent = failed;
        throw error;
    }

    return await stripe.paymentIntents.retrieve(paymentIntentId);
};

module.exports = { createPricePayment };
