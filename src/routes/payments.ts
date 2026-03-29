import { Router } from 'express';

import { processMpesaWebhookPayment } from '../services/groupService';
import { createHttpError, getObjectBody } from '../utils/http';

const router = Router();

const getNestedValue = (value: unknown, path: string[]): unknown => {
  let current = value;

  for (const key of path) {
    if (typeof current !== 'object' || current === null || Array.isArray(current)) {
      return undefined;
    }

    current = (current as Record<string, unknown>)[key];
  }

  return current;
};

const coercePositiveNumber = (value: unknown): number | null => {
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

const coerceNonEmptyString = (value: unknown): string | null => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }

  return value.trim();
};

router.post('/mpesa/webhook', async (req, res, next) => {
  try {
    const payload = getObjectBody(req.body);
    const amount =
      coercePositiveNumber(payload.amount) ??
      coercePositiveNumber(payload.TransAmount) ??
      coercePositiveNumber(getNestedValue(payload, ['TransAmount']));
    const accountNumber =
      coerceNonEmptyString(payload.BillRefNumber) ??
      coerceNonEmptyString(payload.accountNumber) ??
      coerceNonEmptyString(getNestedValue(payload, ['BillRefNumber']));
    const phoneNumber =
      coerceNonEmptyString(payload.MSISDN) ??
      coerceNonEmptyString(payload.phoneNumber) ??
      coerceNonEmptyString(getNestedValue(payload, ['MSISDN']));
    const receiptCode =
      coerceNonEmptyString(payload.TransID) ??
      coerceNonEmptyString(payload.receiptCode) ??
      coerceNonEmptyString(getNestedValue(payload, ['TransID']));

    if (!amount || !accountNumber || !phoneNumber || !receiptCode) {
      throw createHttpError(400, 'Invalid M-Pesa webhook payload');
    }

    const result = await processMpesaWebhookPayment(
      amount,
      accountNumber,
      phoneNumber,
      receiptCode,
    );

    res.json({
      success: true,
      duplicate: result.duplicate,
      groupId: result.group.id,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
