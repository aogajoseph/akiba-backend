"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const http_1 = require("../utils/http");
const auth_1 = require("../utils/auth");
const userService_1 = require("../services/userService");
const router = (0, express_1.Router)();
const getCurrentUser = async (headerValue) => {
    const userId = (0, http_1.ensureNonEmptyString)(headerValue, 'x-user-id header is required');
    return (0, auth_1.getCurrentUserOrThrow)(userId);
};
router.delete('/me', async (req, res, next) => {
    try {
        const user = await getCurrentUser(req.header('x-user-id'));
        const userId = await (0, userService_1.deleteCurrentUser)(user.id);
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
