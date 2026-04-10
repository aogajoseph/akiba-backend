"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.emitNotification = void 0;
const prisma_1 = require("../lib/prisma");
const notificationRealtimeService_1 = require("./notificationRealtimeService");
const emitNotification = async ({ type, spaceId, transactionId, actorId, title, body, metadata, eventKey, }) => {
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
            spaceId,
            transactionId,
            title,
            body,
            metadata: metadata,
        },
    });
    const members = await prisma_1.prisma.spaceMember.findMany({
        where: { spaceId },
        select: { userId: true },
    });
    await prisma_1.prisma.notificationRecipient.createMany({
        data: members.map((member) => ({
            notificationId: notification.id,
            userId: member.userId,
        })),
        skipDuplicates: true,
    });
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
    recipients.forEach((recipient) => {
        (0, notificationRealtimeService_1.broadcastNotificationCreated)({
            userId: recipient.userId,
            notification: {
                id: notification.id,
                cursorId: recipient.id,
                type: notification.type,
                title,
                body,
                createdAt: notification.createdAt.toISOString(),
                spaceId,
                transactionId,
                isRead: recipient.isRead,
            },
        });
    });
    return notification;
};
exports.emitNotification = emitNotification;
