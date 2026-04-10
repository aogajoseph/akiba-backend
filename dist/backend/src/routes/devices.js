"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const deviceService_1 = require("../services/deviceService");
const auth_1 = require("../utils/auth");
const http_1 = require("../utils/http");
const router = (0, express_1.Router)();
const getCurrentUser = async (headerValue) => {
    const userId = (0, http_1.ensureNonEmptyString)(headerValue, 'x-user-id header is required');
    return (0, auth_1.getCurrentUserOrThrow)(userId);
};
router.post('/', async (req, res, next) => {
    try {
        const user = await getCurrentUser(req.header('x-user-id'));
        const token = (0, http_1.ensureNonEmptyString)(req.body?.token, 'token is required');
        const result = await (0, deviceService_1.registerDeviceToken)({
            userId: user.id,
            token,
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
