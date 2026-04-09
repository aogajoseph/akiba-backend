"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.markNotificationAsRead = exports.getUserNotifications = void 0;
const prisma_1 = require("../lib/prisma");
const getUserNotifications = async ({ userId, cursor, limit = 20, }) => {
    const notifications = await prisma_1.prisma.notificationRecipient.findMany({
        where: {
            userId,
        },
        include: {
            notification: true,
        },
        orderBy: {
            createdAt: 'desc',
        },
        take: limit + 1,
        ...(cursor
            ? {
                skip: 1,
                cursor: { id: cursor },
            }
            : {}),
    });
    const hasNext = notifications.length > limit;
    const items = hasNext ? notifications.slice(0, limit) : notifications;
    return {
        notifications: items.map((item) => ({
            id: item.notification.id,
            type: item.notification.type,
            title: item.notification.title,
            body: item.notification.body,
            createdAt: item.notification.createdAt.toISOString(),
            spaceId: item.notification.spaceId,
            transactionId: item.notification.transactionId,
            isRead: item.isRead,
        })),
        nextCursor: hasNext ? items[items.length - 1]?.id : undefined,
    };
};
exports.getUserNotifications = getUserNotifications;
const markNotificationAsRead = async ({ userId, notificationId, }) => {
    await prisma_1.prisma.notificationRecipient.updateMany({
        where: {
            userId,
            notificationId,
        },
        data: {
            isRead: true,
            readAt: new Date(),
        },
    });
    return { success: true };
};
exports.markNotificationAsRead = markNotificationAsRead;
