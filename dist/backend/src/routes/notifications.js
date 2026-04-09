"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../utils/auth");
const http_1 = require("../utils/http");
const notificationQueryService_1 = require("../services/notificationQueryService");
const router = (0, express_1.Router)();
const getCurrentUser = async (headerValue) => {
    const userId = (0, http_1.ensureNonEmptyString)(headerValue, 'x-user-id header is required');
    return (0, auth_1.getCurrentUserOrThrow)(userId);
};
router.get('/', async (req, res, next) => {
    try {
        const user = await getCurrentUser(req.header('x-user-id'));
        const cursor = req.query.cursor === undefined
            ? undefined
            : (0, http_1.ensureNonEmptyString)(req.query.cursor, 'cursor must be a non-empty string');
        const limit = req.query.limit === undefined
            ? 20
            : (0, http_1.ensurePositiveInteger)(Number(req.query.limit), 'limit must be a positive integer');
        if (limit > 100) {
            throw (0, http_1.createHttpError)(400, 'limit cannot exceed 100');
        }
        const result = await (0, notificationQueryService_1.getUserNotifications)({
            userId: user.id,
            cursor,
            limit,
        });
        const response = {
            data: result,
        };
        res.json(response);
    }
    catch (error) {
        next(error);
    }
});
router.patch('/:id/read', async (req, res, next) => {
    try {
        const user = await getCurrentUser(req.header('x-user-id'));
        const notificationId = (0, http_1.ensureNonEmptyString)(req.params.id, 'notification id is required');
        const result = await (0, notificationQueryService_1.markNotificationAsRead)({
            userId: user.id,
            notificationId,
        });
        const response = {
            data: result,
        };
        res.json(response);
    }
    catch (error) {
        next(error);
    }
});
exports.default = router;
