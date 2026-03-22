"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const store_1 = require("../data/store");
const http_1 = require("../utils/http");
const media_1 = require("../utils/media");
const router = (0, express_1.Router)({ mergeParams: true });
const getCurrentUser = (headerValue) => {
    const userId = (0, http_1.ensureNonEmptyString)(headerValue, 'x-user-id header is required');
    const user = store_1.users.find((item) => item.id === userId);
    if (!user) {
        throw (0, http_1.createHttpError)(404, 'User not found');
    }
    return user;
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
router.get('/', (req, res, next) => {
    try {
        const { groupId } = req.params;
        const user = getCurrentUser(req.header('x-user-id'));
        getGroupById(groupId);
        requireMembership(groupId, user.id);
        const response = {
            data: {
                messages: store_1.messages
                    .filter((item) => item.groupId === groupId)
                    .map((item) => ({
                    ...item,
                    reactions: item.reactions ?? [],
                    status: item.status ?? 'sent',
                })),
            },
        };
        res.json(response);
    }
    catch (error) {
        next(error);
    }
});
router.post('/', (req, res, next) => {
    try {
        const { groupId } = req.params;
        const user = getCurrentUser(req.header('x-user-id'));
        getGroupById(groupId);
        requireMembership(groupId, user.id);
        const body = (0, http_1.getObjectBody)(req.body);
        const dto = {
            text: (0, http_1.ensureNonEmptyString)(body.text, 'text is required'),
            replyToMessageId: (0, http_1.ensureOptionalNonEmptyString)(body.replyToMessageId, 'replyToMessageId must be a non-empty string'),
        };
        if (dto.replyToMessageId &&
            !store_1.messages.some((item) => item.groupId === groupId && item.id === dto.replyToMessageId)) {
            throw (0, http_1.createHttpError)(404, 'Reply target message not found');
        }
        const message = {
            id: (0, http_1.createId)('message'),
            groupId,
            senderUserId: user.id,
            text: dto.text,
            replyToMessageId: dto.replyToMessageId,
            reactions: [],
            status: 'sent',
            createdAt: new Date().toISOString(),
        };
        store_1.messages.push(message);
        const response = {
            data: {
                message,
            },
        };
        res.status(201).json(response);
    }
    catch (error) {
        next(error);
    }
});
router.post('/media', async (req, res, next) => {
    try {
        const { groupId } = req.params;
        const user = getCurrentUser(req.header('x-user-id'));
        getGroupById(groupId);
        requireMembership(groupId, user.id);
        const { fields, files } = await (0, media_1.parseMultipartFormData)(req);
        const text = (0, http_1.ensureOptionalNonEmptyString)(fields.text, 'text must be a non-empty string');
        const replyToMessageId = (0, http_1.ensureOptionalNonEmptyString)(fields.replyToMessageId, 'replyToMessageId must be a non-empty string');
        if (replyToMessageId && !store_1.messages.some((item) => item.groupId === groupId && item.id === replyToMessageId)) {
            throw (0, http_1.createHttpError)(404, 'Reply target message not found');
        }
        const media = await (0, media_1.storeMediaFiles)(req, files.filter((file) => file.fieldName === 'file'));
        const message = {
            id: (0, http_1.createId)('message'),
            groupId,
            senderUserId: user.id,
            text: text ?? '',
            replyToMessageId,
            media,
            reactions: [],
            status: 'sent',
            createdAt: new Date().toISOString(),
        };
        store_1.messages.push(message);
        const response = {
            data: {
                message,
            },
        };
        res.status(201).json(response);
    }
    catch (error) {
        next(error);
    }
});
router.post('/:messageId/reactions', (req, res, next) => {
    try {
        const { groupId, messageId } = req.params;
        const user = getCurrentUser(req.header('x-user-id'));
        getGroupById(groupId);
        requireMembership(groupId, user.id);
        const body = (0, http_1.getObjectBody)(req.body);
        const dto = {
            emoji: (0, http_1.ensureNonEmptyString)(body.emoji, 'emoji is required'),
        };
        const message = store_1.messages.find((item) => item.groupId === groupId && item.id === messageId);
        if (!message) {
            throw (0, http_1.createHttpError)(404, 'Message not found');
        }
        message.reactions = message.reactions ?? [];
        const reaction = message.reactions.find((item) => item.emoji === dto.emoji);
        if (reaction?.userIds.includes(user.id)) {
            reaction.userIds = reaction.userIds.filter((userId) => userId !== user.id);
        }
        else if (reaction) {
            reaction.userIds.push(user.id);
        }
        else {
            message.reactions.push({
                emoji: dto.emoji,
                userIds: [user.id],
            });
        }
        message.reactions = message.reactions.filter((item) => item.userIds.length > 0);
        const response = {
            data: {
                message,
            },
        };
        res.json(response);
    }
    catch (error) {
        next(error);
    }
});
router.delete('/:messageId', (req, res, next) => {
    try {
        const { groupId, messageId } = req.params;
        const user = getCurrentUser(req.header('x-user-id'));
        getGroupById(groupId);
        requireMembership(groupId, user.id);
        const messageIndex = store_1.messages.findIndex((item) => item.groupId === groupId && item.id === messageId);
        if (messageIndex < 0) {
            throw (0, http_1.createHttpError)(404, 'Message not found');
        }
        if (store_1.messages[messageIndex].senderUserId !== user.id) {
            throw (0, http_1.createHttpError)(403, 'You can only delete your own messages');
        }
        store_1.messages.splice(messageIndex, 1);
        const response = {
            data: {
                success: true,
            },
        };
        res.json(response);
    }
    catch (error) {
        next(error);
    }
});
exports.default = router;
