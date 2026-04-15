"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const http_1 = require("../utils/http");
const auth_1 = require("../utils/auth");
const media_1 = require("../utils/media");
const chatService_1 = require("../services/chatService");
const router = (0, express_1.Router)({ mergeParams: true });
const getCurrentUser = async (headerValue) => {
    const userId = (0, http_1.ensureNonEmptyString)(headerValue, 'x-user-id header is required');
    return (0, auth_1.getCurrentUserOrThrow)(userId);
};
const getSpaceId = (params) => {
    return (0, http_1.ensureNonEmptyString)(params.spaceId ?? params.groupId, 'spaceId is required');
};
const ensureOptionalHttpUrlString = (value, fieldName) => {
    if (!value) {
        return undefined;
    }
    let parsedUrl;
    try {
        parsedUrl = new URL(value);
    }
    catch {
        throw (0, http_1.createHttpError)(400, `${fieldName} must be a valid URL`);
    }
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        throw (0, http_1.createHttpError)(400, `${fieldName} must be an http or https URL`);
    }
    return parsedUrl.toString();
};
const inferMediaTypeFromUrl = (mediaUrl) => {
    const normalizedUrl = mediaUrl.toLowerCase();
    if (normalizedUrl.includes('.mp4') ||
        normalizedUrl.includes('.mov') ||
        normalizedUrl.includes('.webm') ||
        normalizedUrl.includes('/video/upload/')) {
        return 'video';
    }
    return 'image';
};
router.get('/', async (req, res, next) => {
    try {
        const spaceId = getSpaceId(req.params);
        const user = await getCurrentUser(req.header('x-user-id'));
        const rawCursor = typeof req.query.cursor === 'string' ? req.query.cursor.trim() : undefined;
        const rawLimit = typeof req.query.limit === 'string' ? req.query.limit.trim() : undefined;
        const rawSince = typeof req.query.since === 'string' ? req.query.since.trim() : undefined;
        let limit;
        let since;
        if (rawLimit) {
            limit = Number(rawLimit);
            if (!Number.isFinite(limit) || !Number.isInteger(limit) || limit < 1) {
                throw (0, http_1.createHttpError)(400, 'limit must be a positive integer');
            }
        }
        if (rawSince) {
            since = new Date(rawSince);
            if (Number.isNaN(since.getTime())) {
                throw (0, http_1.createHttpError)(400, 'since must be a valid ISO date string');
            }
        }
        const response = {
            data: await (0, chatService_1.listMessages)(spaceId, user.id, {
                cursor: rawCursor,
                limit,
                since,
            }),
        };
        res.json(response);
    }
    catch (error) {
        next(error);
    }
});
router.post('/', async (req, res, next) => {
    try {
        const spaceId = getSpaceId(req.params);
        const user = await getCurrentUser(req.header('x-user-id'));
        const body = (0, http_1.getObjectBody)(req.body);
        const dto = {
            text: (0, http_1.ensureNonEmptyString)(body.text, 'text is required'),
            replyToMessageId: (0, http_1.ensureOptionalNonEmptyString)(body.replyToMessageId, 'replyToMessageId must be a non-empty string'),
        };
        const response = {
            data: {
                message: await (0, chatService_1.createMessage)({
                    spaceId,
                    userId: user.id,
                    text: dto.text,
                    replyToMessageId: dto.replyToMessageId,
                }),
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
        const spaceId = getSpaceId(req.params);
        const user = await getCurrentUser(req.header('x-user-id'));
        const { fields, files } = await (0, media_1.parseMultipartFormData)(req);
        const text = (0, http_1.ensureOptionalNonEmptyString)(fields.text, 'text must be a non-empty string');
        const replyToMessageId = (0, http_1.ensureOptionalNonEmptyString)(fields.replyToMessageId, 'replyToMessageId must be a non-empty string');
        const mediaUrl = ensureOptionalHttpUrlString((0, http_1.ensureOptionalNonEmptyString)(fields.mediaUrl, 'mediaUrl must be a non-empty string'), 'mediaUrl');
        const mediaTypeField = (0, http_1.ensureOptionalNonEmptyString)(fields.mediaType, 'mediaType must be a non-empty string');
        const uploadedFiles = files.filter((file) => file.fieldName === 'file');
        const media = uploadedFiles.length > 0
            ? await (0, media_1.storeMediaFiles)(req, uploadedFiles)
            : mediaUrl
                ? [
                    {
                        type: mediaTypeField === 'image' || mediaTypeField === 'video'
                            ? mediaTypeField
                            : inferMediaTypeFromUrl(mediaUrl),
                        url: mediaUrl,
                    },
                ]
                : (() => {
                    throw (0, http_1.createHttpError)(400, 'At least one media file or mediaUrl is required');
                })();
        const response = {
            data: {
                message: await (0, chatService_1.createMessage)({
                    spaceId,
                    userId: user.id,
                    text,
                    replyToMessageId,
                    media,
                }),
            },
        };
        res.status(201).json(response);
    }
    catch (error) {
        next(error);
    }
});
router.post('/:messageId/reactions', async (req, res, next) => {
    try {
        const spaceId = getSpaceId(req.params);
        const { messageId } = req.params;
        const user = await getCurrentUser(req.header('x-user-id'));
        const body = (0, http_1.getObjectBody)(req.body);
        const dto = {
            emoji: (0, http_1.ensureNonEmptyString)(body.emoji, 'emoji is required'),
        };
        const response = {
            data: {
                message: await (0, chatService_1.toggleMessageReaction)({
                    spaceId,
                    messageId,
                    userId: user.id,
                    emoji: dto.emoji,
                }),
            },
        };
        res.json(response);
    }
    catch (error) {
        next(error);
    }
});
router.delete('/:messageId', async (req, res, next) => {
    try {
        const spaceId = getSpaceId(req.params);
        const { messageId } = req.params;
        const user = await getCurrentUser(req.header('x-user-id'));
        await (0, chatService_1.deleteMessage)({
            spaceId,
            messageId,
            userId: user.id,
        });
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
