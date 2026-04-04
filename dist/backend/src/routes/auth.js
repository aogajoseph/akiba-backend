"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const prisma_1 = require("../lib/prisma");
const auth_1 = require("../utils/auth");
const http_1 = require("../utils/http");
const router = (0, express_1.Router)();
const isUniqueConstraintError = (error) => {
    return (typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'P2002');
};
router.post('/register', async (req, res, next) => {
    try {
        const body = (0, http_1.getObjectBody)(req.body);
        const dto = {
            name: (0, http_1.ensureNonEmptyString)(body.name, 'Name is required'),
            phoneNumber: (0, http_1.ensureNonEmptyString)(body.phoneNumber, 'Phone Number is required'),
        };
        let createdUser;
        try {
            createdUser = await prisma_1.prisma.user.create({
                data: {
                    name: dto.name,
                    phone: dto.phoneNumber,
                },
            });
        }
        catch (error) {
            if (isUniqueConstraintError(error)) {
                throw (0, http_1.createHttpError)(409, 'A user with that phone number already exists');
            }
            throw error;
        }
        const user = (0, auth_1.mapDbUserToContractUser)(createdUser);
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
router.post('/login', async (req, res, next) => {
    try {
        const body = (0, http_1.getObjectBody)(req.body);
        const dto = {
            phoneNumber: (0, http_1.ensureNonEmptyString)(body.phoneNumber, 'Phone Number is required'),
        };
        const dbUser = await prisma_1.prisma.user.findUnique({
            where: {
                phone: dto.phoneNumber,
            },
        });
        if (!dbUser) {
            throw (0, http_1.createHttpError)(404, 'User not found');
        }
        const user = (0, auth_1.mapDbUserToContractUser)(dbUser);
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
router.get('/me', async (req, res, next) => {
    try {
        const userId = (0, http_1.ensureNonEmptyString)(req.header('x-user-id'), 'x-user-id header is required');
        const dbUser = await prisma_1.prisma.user.findUnique({
            where: {
                id: userId,
            },
        });
        if (!dbUser) {
            throw (0, http_1.createHttpError)(404, 'User not found');
        }
        const user = (0, auth_1.mapDbUserToContractUser)(dbUser);
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
