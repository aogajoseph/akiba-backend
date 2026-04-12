"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.markNotificationAsRead = exports.getUserNotifications = void 0;
const prisma_1 = require("../lib/prisma");
const http_1 = require("../utils/http");
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
            cursorId: item.id,
            type: item.notification.type,
            title: item.notification.title,
            body: item.notification.body,
            createdAt: item.notification.createdAt.toISOString(),
            spaceId: item.notification.spaceId ?? undefined,
            transactionId: item.notification.transactionId ?? undefined,
            metadata: item.notification.metadata &&
                typeof item.notification.metadata === 'object' &&
                !Array.isArray(item.notification.metadata)
                ? item.notification.metadata
                : undefined,
            isRead: item.isRead,
        })),
        nextCursor: hasNext ? items[items.length - 1]?.id : undefined,
    };
};
exports.getUserNotifications = getUserNotifications;
const markNotificationAsRead = async ({ userId, notificationId, }) => {
    const result = await prisma_1.prisma.notificationRecipient.updateMany({
        where: {
            userId,
            notificationId,
        },
        data: {
            isRead: true,
            readAt: new Date(),
        },
    });
    if (result.count === 0) {
        throw (0, http_1.createHttpError)(404, 'Notification not found');
    }
    return { success: true };
};
exports.markNotificationAsRead = markNotificationAsRead;
