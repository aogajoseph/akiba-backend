"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorHandler = exports.createId = exports.ensureEnumValue = exports.ensurePositiveInteger = exports.ensurePositiveNumber = exports.ensureOptionalNonEmptyString = exports.ensureNonEmptyString = exports.getObjectBody = exports.createHttpError = exports.HttpError = void 0;
class HttpError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
        this.name = 'HttpError';
    }
}
exports.HttpError = HttpError;
const createHttpError = (status, message) => {
    return new HttpError(status, message);
};
exports.createHttpError = createHttpError;
const getObjectBody = (value) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw (0, exports.createHttpError)(400, 'Request body must be a JSON object');
    }
    return value;
};
exports.getObjectBody = getObjectBody;
const ensureNonEmptyString = (value, message) => {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw (0, exports.createHttpError)(400, message);
    }
    return value.trim();
};
exports.ensureNonEmptyString = ensureNonEmptyString;
const ensureOptionalNonEmptyString = (value, message) => {
    if (value === undefined || value === null) {
        return undefined;
    }
    return (0, exports.ensureNonEmptyString)(value, message);
};
exports.ensureOptionalNonEmptyString = ensureOptionalNonEmptyString;
const ensurePositiveNumber = (value, message) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        throw (0, exports.createHttpError)(400, message);
    }
    return value;
};
exports.ensurePositiveNumber = ensurePositiveNumber;
const ensurePositiveInteger = (value, message) => {
    if (!Number.isInteger(value) || Number(value) <= 0) {
        throw (0, exports.createHttpError)(400, message);
    }
    return Number(value);
};
exports.ensurePositiveInteger = ensurePositiveInteger;
const ensureEnumValue = (value, allowedValues, message) => {
    if (typeof value !== 'string' || !allowedValues.includes(value)) {
        throw (0, exports.createHttpError)(400, message);
    }
    return value;
};
exports.ensureEnumValue = ensureEnumValue;
const createId = (prefix) => {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
};
exports.createId = createId;
const errorHandler = (error, _req, res, _next) => {
    if (error instanceof HttpError) {
        res.status(error.status).json({ error: error.message });
        return;
    }
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(500).json({ error: message });
};
exports.errorHandler = errorHandler;
