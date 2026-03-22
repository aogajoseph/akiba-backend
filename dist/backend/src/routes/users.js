"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const store_1 = require("../data/store");
const http_1 = require("../utils/http");
const userService_1 = require("../services/userService");
const router = (0, express_1.Router)();
const getCurrentUser = (headerValue) => {
    const userId = (0, http_1.ensureNonEmptyString)(headerValue, 'x-user-id header is required');
    const user = store_1.users.find((item) => item.id === userId);
    if (!user) {
        throw (0, http_1.createHttpError)(404, 'User not found');
    }
    return user;
};
router.delete('/me', (req, res, next) => {
    try {
        const user = getCurrentUser(req.header('x-user-id'));
        const userId = (0, userService_1.deleteCurrentUser)(user.id);
        const response = {
            data: {
                userId,
            },
        };
        res.json(response);
    }
    catch (error) {
        next(error);
    }
});
exports.default = router;
