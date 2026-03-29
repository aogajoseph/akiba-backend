"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
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
router.post('/mpesa/webhook', async (req, res, next) => {
    try {
        const payload = (0, http_1.getObjectBody)(req.body);
        const amount = coercePositiveNumber(payload.amount) ??
            coercePositiveNumber(payload.TransAmount) ??
            coercePositiveNumber(getNestedValue(payload, ['TransAmount']));
        const accountNumber = coerceNonEmptyString(payload.BillRefNumber) ??
            coerceNonEmptyString(payload.accountNumber) ??
            coerceNonEmptyString(getNestedValue(payload, ['BillRefNumber']));
        const phoneNumber = coerceNonEmptyString(payload.MSISDN) ??
            coerceNonEmptyString(payload.phoneNumber) ??
            coerceNonEmptyString(getNestedValue(payload, ['MSISDN']));
        const receiptCode = coerceNonEmptyString(payload.TransID) ??
            coerceNonEmptyString(payload.receiptCode) ??
            coerceNonEmptyString(getNestedValue(payload, ['TransID']));
        if (!amount || !accountNumber || !phoneNumber || !receiptCode) {
            throw (0, http_1.createHttpError)(400, 'Invalid M-Pesa webhook payload');
        }
        const result = await (0, groupService_1.processMpesaWebhookPayment)(amount, accountNumber, phoneNumber, receiptCode);
        res.json({
            success: true,
            duplicate: result.duplicate,
            groupId: result.group.id,
        });
    }
    catch (error) {
        next(error);
    }
});
exports.default = router;
