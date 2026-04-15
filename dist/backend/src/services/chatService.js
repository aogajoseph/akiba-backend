"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteMessage = exports.toggleMessageReaction = exports.createMessage = exports.listMessages = void 0;
const prisma_1 = require("../lib/prisma");
const chatRealtimeService_1 = require("./chatRealtimeService");
const http_1 = require("../utils/http");
const normalizeMessageMedia = (media) => {
    if (!media?.length) {
        return undefined;
    }
    return media.map((item) => {
        const normalizedUrl = item.url.trim();
        if (!normalizedUrl) {
            throw (0, http_1.createHttpError)(400, 'Media URL is required');
        }
        if (item.type !== 'image' && item.type !== 'video') {
            throw (0, http_1.createHttpError)(400, 'Media type must be image or video');
        }
        return {
            type: item.type,
            url: normalizedUrl,
        };
    });
};
const ensureSpaceMembership = async (spaceId, userId) => {
    const [space, membership] = await Promise.all([
        prisma_1.prisma.space.findUnique({
            where: {
                id: spaceId,
            },
        }),
        prisma_1.prisma.spaceMember.findFirst({
            where: {
                spaceId,
                userId,
            },
        }),
    ]);
    if (!space) {
        throw (0, http_1.createHttpError)(404, 'Group not found');
    }
    if (!membership) {
        throw (0, http_1.createHttpError)(403, 'You are not a member of this group');
    }
};
const ensureReplyTargetInSpace = async (spaceId, replyToMessageId, tx = prisma_1.prisma) => {
    if (!replyToMessageId) {
        return;
    }
    const replyTarget = await tx.message.findFirst({
        where: {
            id: replyToMessageId,
            spaceId,
        },
        select: {
            id: true,
        },
    });
    if (!replyTarget) {
        throw (0, http_1.createHttpError)(404, 'Reply target message not found');
    }
};
const mapDbMessageToContractMessage = (message) => {
    const reactionsByEmoji = new Map();
    for (const reaction of message.reactions) {
        const userIds = reactionsByEmoji.get(reaction.emoji) ?? [];
        userIds.push(reaction.userId);
        reactionsByEmoji.set(reaction.emoji, userIds);
    }
    const media = message.attachments.map((attachment) => ({
        type: attachment.type,
        url: attachment.url,
    }));
    return {
        id: message.id,
        groupId: message.spaceId,
        senderUserId: message.userId,
        text: message.text,
        replyToMessageId: message.replyToId ?? undefined,
        media: media.length > 0 ? media : undefined,
        reactions: Array.from(reactionsByEmoji.entries()).map(([emoji, userIds]) => ({
            emoji,
            userIds,
        })),
        status: message.status ?? 'sent',
        createdAt: message.createdAt.toISOString(),
    };
};
const getMessageByIdOrThrow = async (spaceId, messageId) => {
    const message = await prisma_1.prisma.message.findFirst({
        where: {
            id: messageId,
            spaceId,
        },
        include: {
            attachments: {
                orderBy: {
                    createdAt: 'asc',
                },
            },
            reactions: {
                orderBy: {
                    createdAt: 'asc',
                },
            },
        },
    });
    if (!message) {
        throw (0, http_1.createHttpError)(404, 'Message not found');
    }
    return message;
};
const listMessages = async (spaceId, userId, options) => {
    await ensureSpaceMembership(spaceId, userId);
    const normalizedLimit = Math.min(Math.max(options?.limit ?? 20, 1), 50);
    const shouldPaginate = !options?.since || Boolean(options?.cursor);
    let cursorMessage = null;
    if (options?.cursor) {
        cursorMessage = await prisma_1.prisma.message.findFirst({
            where: {
                id: options.cursor,
                spaceId,
            },
            select: {
                createdAt: true,
                id: true,
            },
        });
    }
    const messages = await prisma_1.prisma.message.findMany({
        where: {
            spaceId,
            ...(cursorMessage
                ? {
                    OR: [
                        {
                            createdAt: {
                                lt: cursorMessage.createdAt,
                            },
                        },
                        {
                            createdAt: cursorMessage.createdAt,
                            id: {
                                lt: cursorMessage.id,
                            },
                        },
                    ],
                }
                : {}),
            ...(options?.since
                ? {
                    createdAt: {
                        gte: options.since,
                    },
                }
                : {}),
        },
        include: {
            attachments: {
                orderBy: {
                    createdAt: 'asc',
                },
            },
            reactions: {
                orderBy: {
                    createdAt: 'asc',
                },
            },
        },
        orderBy: [
            {
                createdAt: 'desc',
            },
            {
                id: 'desc',
            },
        ],
        ...(shouldPaginate
            ? {
                take: normalizedLimit + 1,
            }
            : {}),
    });
    const hasNext = shouldPaginate && messages.length > normalizedLimit;
    const pageItems = hasNext ? messages.slice(0, normalizedLimit) : messages;
    return {
        messages: pageItems.map(mapDbMessageToContractMessage),
        nextCursor: hasNext ? pageItems[pageItems.length - 1]?.id : undefined,
    };
};
exports.listMessages = listMessages;
const createMessage = async (input) => {
    await ensureSpaceMembership(input.spaceId, input.userId);
    await ensureReplyTargetInSpace(input.spaceId, input.replyToMessageId);
    const normalizedMedia = normalizeMessageMedia(input.media);
    const createdMessage = await prisma_1.prisma.message.create({
        data: {
            spaceId: input.spaceId,
            userId: input.userId,
            text: input.text ?? '',
            replyToId: input.replyToMessageId,
            status: 'sent',
            attachments: normalizedMedia?.length
                ? {
                    create: normalizedMedia.map((item) => ({
                        type: item.type,
                        url: item.url,
                    })),
                }
                : undefined,
        },
        include: {
            attachments: {
                orderBy: {
                    createdAt: 'asc',
                },
            },
            reactions: {
                orderBy: {
                    createdAt: 'asc',
                },
            },
        },
    });
    const message = mapDbMessageToContractMessage(createdMessage);
    (0, chatRealtimeService_1.emitMessageCreated)({
        spaceId: input.spaceId,
        message,
    });
    return message;
};
exports.createMessage = createMessage;
const toggleMessageReaction = async (input) => {
    await ensureSpaceMembership(input.spaceId, input.userId);
    await getMessageByIdOrThrow(input.spaceId, input.messageId);
    const existingReaction = await prisma_1.prisma.messageReaction.findUnique({
        where: {
            messageId_userId_emoji: {
                messageId: input.messageId,
                userId: input.userId,
                emoji: input.emoji,
            },
        },
        select: {
            id: true,
        },
    });
    if (existingReaction) {
        await prisma_1.prisma.messageReaction.delete({
            where: {
                id: existingReaction.id,
            },
        });
    }
    else {
        await prisma_1.prisma.messageReaction.create({
            data: {
                messageId: input.messageId,
                userId: input.userId,
                emoji: input.emoji,
            },
        });
    }
    const updatedMessage = await getMessageByIdOrThrow(input.spaceId, input.messageId);
    const message = mapDbMessageToContractMessage(updatedMessage);
    (0, chatRealtimeService_1.emitReactionUpdated)({
        spaceId: input.spaceId,
        message,
    });
    return message;
};
exports.toggleMessageReaction = toggleMessageReaction;
const deleteMessage = async (input) => {
    await ensureSpaceMembership(input.spaceId, input.userId);
    const message = await prisma_1.prisma.message.findFirst({
        where: {
            id: input.messageId,
            spaceId: input.spaceId,
        },
        select: {
            id: true,
            userId: true,
        },
    });
    if (!message) {
        throw (0, http_1.createHttpError)(404, 'Message not found');
    }
    if (message.userId !== input.userId) {
        throw (0, http_1.createHttpError)(403, 'You can only delete your own messages');
    }
    await prisma_1.prisma.$transaction(async (tx) => {
        await tx.messageReaction.deleteMany({
            where: {
                messageId: message.id,
            },
        });
        await tx.messageAttachment.deleteMany({
            where: {
                messageId: message.id,
            },
        });
        await tx.message.updateMany({
            where: {
                replyToId: message.id,
            },
            data: {
                replyToId: null,
            },
        });
        await tx.message.delete({
            where: {
                id: message.id,
            },
        });
    });
    (0, chatRealtimeService_1.emitMessageDeleted)({
        spaceId: input.spaceId,
        messageId: message.id,
    });
};
exports.deleteMessage = deleteMessage;
