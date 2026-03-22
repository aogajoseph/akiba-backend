"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const store_1 = require("../data/store");
const http_1 = require("../utils/http");
const router = (0, express_1.Router)();
const getUserById = (userId) => {
    return store_1.users.find((item) => item.id === userId);
};
router.post('/register', (req, res, next) => {
    try {
        const body = (0, http_1.getObjectBody)(req.body);
        const dto = {
            name: (0, http_1.ensureNonEmptyString)(body.name, 'name is required'),
            phoneNumber: (0, http_1.ensureNonEmptyString)(body.phoneNumber, 'phoneNumber is required'),
        };
        const existingUser = store_1.users.find((item) => item.phoneNumber === dto.phoneNumber);
        if (existingUser) {
            throw (0, http_1.createHttpError)(409, 'A user with that phone number already exists');
        }
        const user = {
            id: (0, http_1.createId)('user'),
            name: dto.name,
            phoneNumber: dto.phoneNumber,
            createdAt: new Date().toISOString(),
        };
        store_1.users.push(user);
        const response = {
            data: {
                user,
                token: `token-${user.id}`,
            },
        };
        res.status(201).json(response);
    }
    catch (error) {
        next(error);
    }
});
router.post('/login', (req, res, next) => {
    try {
        const body = (0, http_1.getObjectBody)(req.body);
        const dto = {
            phoneNumber: (0, http_1.ensureNonEmptyString)(body.phoneNumber, 'phoneNumber is required'),
        };
        const user = store_1.users.find((item) => item.phoneNumber === dto.phoneNumber);
        if (!user) {
            throw (0, http_1.createHttpError)(404, 'User not found');
        }
        const response = {
            data: {
                user,
                token: `token-${user.id}`,
            },
        };
        res.json(response);
    }
    catch (error) {
        next(error);
    }
});
router.get('/me', (req, res, next) => {
    try {
        const userId = (0, http_1.ensureNonEmptyString)(req.header('x-user-id'), 'x-user-id header is required');
        const user = getUserById(userId);
        if (!user) {
            throw (0, http_1.createHttpError)(404, 'User not found');
        }
        const response = {
            data: {
                user,
            },
        };
        res.json(response);
    }
    catch (error) {
        next(error);
    }
});
exports.default = router;
