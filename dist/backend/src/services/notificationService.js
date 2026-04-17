"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.emitNotification = void 0;
const prisma_1 = require("../lib/prisma");
const notificationRealtimeService_1 = require("./notificationRealtimeService");
const pushService_1 = require("./pushService");
const emitNotification = async ({ type, spaceId, transactionId, actorId, title, body, metadata, eventKey, recipientUserIds, excludeActorFromRecipients = false, mutedUserIdsForDelivery, }) => {
    const existing = await prisma_1.prisma.notification.findUnique({
        where: { eventKey },
    });
    if (existing) {
        return existing;
    }
    const notification = await prisma_1.prisma.notification.create({
        data: {
            type,
            eventKey,
            actorId: actorId ?? null,
            spaceId: spaceId ?? null,
            transactionId: transactionId ?? null,
            title,
            body,
            metadata: metadata,
        },
    });
    const baseRecipientIds = recipientUserIds
        ? Array.from(new Set(recipientUserIds))
        : spaceId
            ? (await prisma_1.prisma.spaceMember.findMany({
                where: { spaceId },
                select: { userId: true },
            })).map((member) => member.userId)
            : [];
    const recipientIds = excludeActorFromRecipients
        ? baseRecipientIds.filter((userId) => userId !== actorId)
        : baseRecipientIds;
    if (recipientIds.length > 0) {
        await prisma_1.prisma.notificationRecipient.createMany({
            data: recipientIds.map((userId) => ({
                notificationId: notification.id,
                userId,
            })),
            skipDuplicates: true,
        });
    }
    const recipients = await prisma_1.prisma.notificationRecipient.findMany({
        where: {
            notificationId: notification.id,
        },
        select: {
            id: true,
            userId: true,
            isRead: true,
        },
    });
    const mutedUserIds = mutedUserIdsForDelivery !== undefined
        ? new Set(mutedUserIdsForDelivery)
        : spaceId
            ? new Set((await prisma_1.prisma.spaceNotificationPreference.findMany({
                where: {
                    spaceId,
                    muted: true,
                },
                select: {
                    userId: true,
                },
            })).map((preference) => preference.userId))
            : new Set();
    const activeRecipients = recipients.filter((recipient) => !mutedUserIds.has(recipient.userId));
    activeRecipients.forEach((recipient) => {
        (0, notificationRealtimeService_1.broadcastNotificationCreated)({
            userId: recipient.userId,
            notification: {
                id: notification.id,
                cursorId: recipient.id,
                type: notification.type,
                title,
                body,
                createdAt: notification.createdAt.toISOString(),
                spaceId: spaceId ?? undefined,
                transactionId: transactionId ?? undefined,
                metadata,
                isRead: recipient.isRead,
            },
        });
    });
    await Promise.allSettled(activeRecipients.map((recipient) => (0, pushService_1.sendPushToUser)(recipient.userId, notification.title, notification.body)));
    return notification;
};
exports.emitNotification = emitNotification;
