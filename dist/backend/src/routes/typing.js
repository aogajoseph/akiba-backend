"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const store_1 = require("../data/store");
const prisma_1 = require("../lib/prisma");
const http_1 = require("../utils/http");
const auth_1 = require("../utils/auth");
const router = (0, express_1.Router)({ mergeParams: true });
const getCurrentUser = async (headerValue) => {
    const userId = (0, http_1.ensureNonEmptyString)(headerValue, 'x-user-id header is required');
    return (0, auth_1.getCurrentUserOrThrow)(userId);
};
const getSpaceId = (params) => {
    return (0, http_1.ensureNonEmptyString)(params.spaceId ?? params.groupId, 'spaceId is required');
};
const getSpaceById = async (spaceId) => {
    const space = await prisma_1.prisma.space.findUnique({
        where: {
            id: spaceId,
        },
    });
    if (!space) {
        throw (0, http_1.createHttpError)(404, 'Group not found');
    }
    return space;
};
const requireMembership = async (spaceId, userId) => {
    const membership = await prisma_1.prisma.spaceMember.findFirst({
        where: {
            spaceId,
            userId,
        },
    });
    if (!membership) {
        throw (0, http_1.createHttpError)(403, 'You are not a member of this group');
    }
    return membership;
};
const getTypingSet = (spaceId) => {
    if (!store_1.typingUsers[spaceId]) {
        store_1.typingUsers[spaceId] = new Set();
    }
    return store_1.typingUsers[spaceId];
};
router.get('/', async (req, res, next) => {
    try {
        const spaceId = getSpaceId(req.params);
        const user = await getCurrentUser(req.header('x-user-id'));
        await getSpaceById(spaceId);
        await requireMembership(spaceId, user.id);
        const typingUserIds = Array.from(getTypingSet(spaceId));
        const usersById = await (0, auth_1.getUsersByIds)(typingUserIds);
        const response = {
            data: {
                users: typingUserIds
                    .map((userId) => {
                    const typingUser = usersById.get(userId);
                    if (!typingUser) {
                        return null;
                    }
                    return {
                        userId: typingUser.id,
                        name: typingUser.name,
                    };
                })
                    .filter((item) => item !== null),
            },
        };
        res.json(response);
    }
    catch (error) {
        next(error);
    }
});
router.post('/start', async (req, res, next) => {
    try {
        const spaceId = getSpaceId(req.params);
        const user = await getCurrentUser(req.header('x-user-id'));
        await getSpaceById(spaceId);
        await requireMembership(spaceId, user.id);
        getTypingSet(spaceId).add(user.id);
        res.status(204).send();
    }
    catch (error) {
        next(error);
    }
});
router.post('/stop', async (req, res, next) => {
    try {
        const spaceId = getSpaceId(req.params);
        const user = await getCurrentUser(req.header('x-user-id'));
        await getSpaceById(spaceId);
        await requireMembership(spaceId, user.id);
        store_1.typingUsers[spaceId]?.delete(user.id);
        if (store_1.typingUsers[spaceId]?.size === 0) {
            delete store_1.typingUsers[spaceId];
        }
        res.status(204).send();
    }
    catch (error) {
        next(error);
    }
});
exports.default = router;
