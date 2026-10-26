// Mocks the Stripe calls behind createPricePayment: a single-line invoice
// whose PaymentIntent is `paymentIntent`.
const mockPricePayment = (mockStripe, paymentIntent) => {
    mockStripe.invoices = {
        ...mockStripe.invoices,
        create: jest.fn().mockResolvedValue({ id: "in_1" }),
        finalizeInvoice: jest.fn().mockResolvedValue({
            id: "in_1",
            payments: {
                data: [{ payment: { payment_intent: paymentIntent.id } }],
            },
        }),
        pay: jest.fn().mockResolvedValue({ id: "in_1", status: "paid" }),
        voidInvoice: jest.fn().mockResolvedValue({ id: "in_1", status: "void" }),
    };
    mockStripe.invoiceItems = { create: jest.fn().mockResolvedValue({}) };
    mockStripe.paymentIntents = {
        ...mockStripe.paymentIntents,
        update: jest.fn().mockResolvedValue(paymentIntent),
        retrieve: jest.fn().mockResolvedValue(paymentIntent),
    };
};

module.exports = { mockPricePayment };
