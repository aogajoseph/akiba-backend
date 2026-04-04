"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const contracts_1 = require("../../../shared/contracts");
const groupService_1 = require("../services/groupService");
const http_1 = require("../utils/http");
const router = (0, express_1.Router)();
const getNestedValue = (value, path) => {
    let current = value;
    for (const key of path) {
        if (typeof current !== 'object' || current === null || Array.isArray(current)) {
            return undefined;
        }
        current = current[key];
    }
    return current;
};
const coercePositiveNumber = (value) => {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        return value;
    }
    if (typeof value === 'string' && value.trim().length > 0) {
        const parsed = Number(value.trim());
        if (Number.isFinite(parsed) && parsed > 0) {
            return parsed;
        }
    }
    return null;
};
const coerceNonEmptyString = (value) => {
    if (typeof value !== 'string' || value.trim().length === 0) {
        return null;
    }
    return value.trim();
};
const coerceTransactionSource = (value) => {
    const normalized = coerceNonEmptyString(value)?.toLowerCase();
    if (!normalized) {
        return null;
    }
    if (normalized === contracts_1.TransactionSource.MPESA_PAYBILL) {
        return contracts_1.TransactionSource.MPESA_PAYBILL;
    }
    if (normalized === contracts_1.TransactionSource.BANK_TRANSFER) {
        return contracts_1.TransactionSource.BANK_TRANSFER;
    }
    return null;
};
const getCallbackMetadataMap = (payload) => {
    const items = getNestedValue(payload, ['Body', 'stkCallback', 'CallbackMetadata', 'Item']);
    if (!Array.isArray(items)) {
        return {};
    }
    return items.reduce((metadata, item) => {
        if (typeof item !== 'object' || item === null || Array.isArray(item)) {
            return metadata;
        }
        const name = coerceNonEmptyString(item.Name);
        if (!name) {
            return metadata;
        }
        metadata[name] = item.Value;
        return metadata;
    }, {});
};
router.post('/mpesa/webhook', async (req, res, next) => {
    let logId = null;
    try {
        const payload = (0, http_1.getObjectBody)(req.body);
        logId = await (0, groupService_1.storeWebhookPayload)(payload);
        const configuredSecret = process.env.MPESA_WEBHOOK_SECRET?.trim();
        const providedSecret = coerceNonEmptyString(req.header('x-webhook-secret'));
        if (!configuredSecret) {
            throw (0, http_1.createHttpError)(500, 'M-Pesa webhook secret is not configured');
        }
        if (!providedSecret || providedSecret !== configuredSecret) {
            throw (0, http_1.createHttpError)(401, 'Invalid webhook secret');
        }
        const callbackMetadata = getCallbackMetadataMap(payload);
        const amount = coercePositiveNumber(callbackMetadata.Amount) ??
            coercePositiveNumber(payload.amount) ??
            coercePositiveNumber(payload.TransAmount) ??
            coercePositiveNumber(getNestedValue(payload, ['TransAmount']));
        const accountNumber = coerceNonEmptyString(callbackMetadata.AccountReference) ??
            coerceNonEmptyString(payload.BillRefNumber) ??
            coerceNonEmptyString(payload.accountNumber) ??
            coerceNonEmptyString(getNestedValue(payload, ['BillRefNumber']));
        const phoneNumber = coerceNonEmptyString(callbackMetadata.PhoneNumber) ??
            coerceNonEmptyString(payload.MSISDN) ??
            coerceNonEmptyString(payload.phoneNumber) ??
            coerceNonEmptyString(getNestedValue(payload, ['MSISDN']));
        const externalName = coerceNonEmptyString(payload.externalName) ??
            coerceNonEmptyString(getNestedValue(payload, ['FirstName'])) ??
            coerceNonEmptyString(getNestedValue(payload, ['firstName']));
        const reference = coerceNonEmptyString(payload.reference) ??
            coerceNonEmptyString(callbackMetadata.MpesaReceiptNumber) ??
            coerceNonEmptyString(payload.TransID) ??
            coerceNonEmptyString(payload.receiptCode) ??
            coerceNonEmptyString(getNestedValue(payload, ['TransID']));
        const source = coerceTransactionSource(payload.source) ??
            coerceTransactionSource(payload.paymentSource) ??
            contracts_1.TransactionSource.MPESA_PAYBILL;
        if (!amount || !accountNumber || !phoneNumber || !reference) {
            throw (0, http_1.createHttpError)(400, 'Invalid M-Pesa webhook payload');
        }
        const result = await (0, groupService_1.processMpesaWebhookPayment)({
            amount,
            accountNumber,
            phoneNumber,
            reference,
            externalName: externalName ?? undefined,
            source,
        });
        await (0, groupService_1.finalizeWebhookLog)(logId, result.duplicate ? `duplicate:${reference}` : `processed:${reference}`, {
            reference,
            spaceId: result.group.id,
            status: result.duplicate ? 'duplicate' : 'processed',
        });
        console.info('M-Pesa webhook processed', {
            accountNumber,
            amount,
            duplicate: result.duplicate,
            groupId: result.group.id,
            reference,
            source,
        });
        res.json({
            success: true,
            duplicate: result.duplicate,
            groupId: result.group.id,
            spaceId: result.group.id,
        });
    }
    catch (error) {
        if (logId) {
            await (0, groupService_1.finalizeWebhookLog)(logId, `failed:${error instanceof Error ? error.message : 'unknown error'}`, {
                errorMessage: error instanceof Error ? error.message : 'unknown error',
                status: 'failed',
            });
        }
        console.error('M-Pesa webhook failed', {
            error: error instanceof Error ? error.message : 'unknown error',
        });
        next(error);
    }
});
exports.default = router;
