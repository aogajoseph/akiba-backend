import { NotificationType, Prisma } from '@prisma/client';

import { prisma } from '../lib/prisma';
import { broadcastNotificationCreated } from './notificationRealtimeService';
import { sendPushToUser } from './pushService';

export const emitNotification = async ({
  type,
  spaceId,
  transactionId,
  actorId,
  title,
  body,
  metadata,
  eventKey,
}: {
  type: NotificationType;
  spaceId: string;
  transactionId: string;
  actorId?: string | null;
  title: string;
  body: string;
  metadata?: Record<string, unknown>;
  eventKey: string;
}) => {
  const existing = await prisma.notification.findUnique({
    where: { eventKey },
  });

  if (existing) {
    return existing;
  }

  const notification = await prisma.notification.create({
    data: {
      type,
      eventKey,
      actorId: actorId ?? null,
      spaceId,
      transactionId,
      title,
      body,
      metadata: metadata as Prisma.InputJsonValue | undefined,
    },
  });

  const members = await prisma.spaceMember.findMany({
    where: { spaceId },
    select: { userId: true },
  });

  await prisma.notificationRecipient.createMany({
    data: members.map((member) => ({
      notificationId: notification.id,
      userId: member.userId,
    })),
    skipDuplicates: true,
  });

  const recipients = await prisma.notificationRecipient.findMany({
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
    broadcastNotificationCreated({
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

  await Promise.allSettled(
    recipients.map((recipient) => sendPushToUser(recipient.userId, notification.title, notification.body)),
  );

  return notification;
};
