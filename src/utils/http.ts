import { ErrorRequestHandler } from 'express';

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const createHttpError = (status: number, message: string): HttpError => {
  return new HttpError(status, message);
};

export const getObjectBody = (value: unknown): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw createHttpError(400, 'Request body must be a JSON object');
  }

  return value as Record<string, unknown>;
};

export const ensureNonEmptyString = (value: unknown, message: string): string => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw createHttpError(400, message);
  }

  return value.trim();
};

export const ensureOptionalNonEmptyString = (
  value: unknown,
  message: string,
): string | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }

  return ensureNonEmptyString(value, message);
};

export const ensurePositiveNumber = (value: unknown, message: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw createHttpError(400, message);
  }

  return value;
};

export const ensurePositiveInteger = (value: unknown, message: string): number => {
  if (!Number.isInteger(value) || Number(value) <= 0) {
    throw createHttpError(400, message);
  }

  return Number(value);
};

export const ensureEnumValue = <T extends string>(
  value: unknown,
  allowedValues: readonly T[],
  message: string,
): T => {
  if (typeof value !== 'string' || !allowedValues.includes(value as T)) {
    throw createHttpError(400, message);
  }

  return value as T;
};

export const createId = (prefix: string): string => {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
};

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.message });
    return;
  }

  const message = error instanceof Error ? error.message : 'Internal server error';
  res.status(500).json({ error: message });
};
