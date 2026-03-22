"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const store_1 = require("../data/store");
const http_1 = require("../utils/http");
const router = (0, express_1.Router)({ mergeParams: true });
const getCurrentUser = (headerValue) => {
    const userId = (0, http_1.ensureNonEmptyString)(headerValue, 'x-user-id header is required');
    const user = store_1.users.find((item) => item.id === userId);
    if (!user) {
        throw (0, http_1.createHttpError)(404, 'User not found');
    }
    return user;
};
const getSpaceId = (params) => {
    return (0, http_1.ensureNonEmptyString)(params.spaceId ?? params.groupId, 'spaceId is required');
};
const getGroupById = (groupId) => {
    const group = store_1.groups.find((item) => item.id === groupId);
    if (!group) {
        throw (0, http_1.createHttpError)(404, 'Group not found');
    }
    return group;
};
const requireMembership = (groupId, userId) => {
    const membership = store_1.groupMembers.find((item) => item.groupId === groupId && item.userId === userId);
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
router.get('/', (req, res, next) => {
    try {
        const spaceId = getSpaceId(req.params);
        const user = getCurrentUser(req.header('x-user-id'));
        getGroupById(spaceId);
        requireMembership(spaceId, user.id);
        const response = {
            data: {
                users: Array.from(getTypingSet(spaceId))
                    .map((userId) => {
                    const typingUser = store_1.users.find((item) => item.id === userId);
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
router.post('/start', (req, res, next) => {
    try {
        const spaceId = getSpaceId(req.params);
        const user = getCurrentUser(req.header('x-user-id'));
        getGroupById(spaceId);
        requireMembership(spaceId, user.id);
        getTypingSet(spaceId).add(user.id);
        res.status(204).send();
    }
    catch (error) {
        next(error);
    }
});
router.post('/stop', (req, res, next) => {
    try {
        const spaceId = getSpaceId(req.params);
        const user = getCurrentUser(req.header('x-user-id'));
        getGroupById(spaceId);
        requireMembership(spaceId, user.id);
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
