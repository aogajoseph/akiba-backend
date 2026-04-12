import { NotificationDTO } from '../../../shared/contracts';
import { prisma } from '../lib/prisma';
import { createHttpError } from '../utils/http';

export const getUserNotifications = async ({
  userId,
  cursor,
  limit = 20,
}: {
  userId: string;
  cursor?: string;
  limit?: number;
}): Promise<{ notifications: NotificationDTO[]; nextCursor?: string }> => {
  const notifications = await prisma.notificationRecipient.findMany({
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
      metadata:
        item.notification.metadata &&
        typeof item.notification.metadata === 'object' &&
        !Array.isArray(item.notification.metadata)
          ? (item.notification.metadata as NotificationDTO['metadata'])
          : undefined,
      isRead: item.isRead,
    })),
    nextCursor: hasNext ? items[items.length - 1]?.id : undefined,
  };
};

export const markNotificationAsRead = async ({
  userId,
  notificationId,
}: {
  userId: string;
  notificationId: string;
}) => {
  const result = await prisma.notificationRecipient.updateMany({
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
    throw createHttpError(404, 'Notification not found');
  }

  return { success: true as const };
};
