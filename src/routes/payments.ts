import { Router } from 'express';

import {
  finalizeWebhookLog,
  processMpesaWebhookPayment,
  storeWebhookPayload,
} from '../services/groupService';
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

const getCallbackMetadataMap = (payload: Record<string, unknown>): Record<string, unknown> => {
  const items = getNestedValue(payload, ['Body', 'stkCallback', 'CallbackMetadata', 'Item']);

  if (!Array.isArray(items)) {
    return {};
  }

  return items.reduce<Record<string, unknown>>((metadata, item) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      return metadata;
    }

    const name = coerceNonEmptyString((item as Record<string, unknown>).Name);

    if (!name) {
      return metadata;
    }

    metadata[name] = (item as Record<string, unknown>).Value;
    return metadata;
  }, {});
};

router.post('/mpesa/webhook', async (req, res, next) => {
  let logId: string | null = null;

  try {
    const payload = getObjectBody(req.body);
    logId = await storeWebhookPayload(payload);
    const configuredSecret = process.env.MPESA_WEBHOOK_SECRET?.trim();
    const providedSecret = coerceNonEmptyString(req.header('x-webhook-secret'));

    if (!configuredSecret) {
      throw createHttpError(500, 'M-Pesa webhook secret is not configured');
    }

    if (!providedSecret || providedSecret !== configuredSecret) {
      throw createHttpError(401, 'Invalid webhook secret');
    }

    const callbackMetadata = getCallbackMetadataMap(payload);
    const amount =
      coercePositiveNumber(callbackMetadata.Amount) ??
      coercePositiveNumber(payload.amount) ??
      coercePositiveNumber(payload.TransAmount) ??
      coercePositiveNumber(getNestedValue(payload, ['TransAmount']));
    const accountNumber =
      coerceNonEmptyString(callbackMetadata.AccountReference) ??
      coerceNonEmptyString(payload.BillRefNumber) ??
      coerceNonEmptyString(payload.accountNumber) ??
      coerceNonEmptyString(getNestedValue(payload, ['BillRefNumber']));
    const phoneNumber =
      coerceNonEmptyString(callbackMetadata.PhoneNumber) ??
      coerceNonEmptyString(payload.MSISDN) ??
      coerceNonEmptyString(payload.phoneNumber) ??
      coerceNonEmptyString(getNestedValue(payload, ['MSISDN']));
    const externalName =
      coerceNonEmptyString(payload.externalName) ??
      coerceNonEmptyString(getNestedValue(payload, ['FirstName'])) ??
      coerceNonEmptyString(getNestedValue(payload, ['firstName']));
    const receiptCode =
      coerceNonEmptyString(callbackMetadata.MpesaReceiptNumber) ??
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
      externalName ?? undefined,
    );

    await finalizeWebhookLog(
      logId,
      result.duplicate ? `duplicate:${receiptCode}` : `processed:${receiptCode}`,
      {
        reference: receiptCode,
        spaceId: result.group.id,
        status: result.duplicate ? 'duplicate' : 'processed',
      },
    );
    console.info('M-Pesa webhook processed', {
      accountNumber,
      amount,
      duplicate: result.duplicate,
      groupId: result.group.id,
      receiptCode,
    });

    res.json({
      success: true,
      duplicate: result.duplicate,
      groupId: result.group.id,
    });
  } catch (error) {
    if (logId) {
      await finalizeWebhookLog(
        logId,
        `failed:${error instanceof Error ? error.message : 'unknown error'}`,
        {
          errorMessage: error instanceof Error ? error.message : 'unknown error',
          status: 'failed',
        },
      );
    }

    console.error('M-Pesa webhook failed', {
      error: error instanceof Error ? error.message : 'unknown error',
    });
    next(error);
  }
});

export default router;
