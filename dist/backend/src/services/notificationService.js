"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.emitNotification = void 0;
const prisma_1 = require("../lib/prisma");
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
    return notification;
};
exports.emitNotification = emitNotification;
