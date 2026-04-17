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
  recipientUserIds,
  excludeActorFromRecipients = false,
  mutedUserIdsForDelivery,
}: {
  type: NotificationType;
  spaceId?: string;
  transactionId?: string;
  actorId?: string | null;
  title: string;
  body: string;
  metadata?: Record<string, unknown>;
  eventKey: string;
  recipientUserIds?: string[];
  excludeActorFromRecipients?: boolean;
  mutedUserIdsForDelivery?: string[];
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
      spaceId: spaceId ?? null,
      transactionId: transactionId ?? null,
      title,
      body,
      metadata: metadata as Prisma.InputJsonValue | undefined,
    },
  });

  const baseRecipientIds = recipientUserIds
    ? Array.from(new Set(recipientUserIds))
    : spaceId
      ? (
          await prisma.spaceMember.findMany({
            where: { spaceId },
            select: { userId: true },
          })
        ).map((member) => member.userId)
      : [];
  const recipientIds = excludeActorFromRecipients
    ? baseRecipientIds.filter((userId) => userId !== actorId)
    : baseRecipientIds;

  if (recipientIds.length > 0) {
    await prisma.notificationRecipient.createMany({
      data: recipientIds.map((userId) => ({
        notificationId: notification.id,
        userId,
      })),
      skipDuplicates: true,
    });
  }

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

  const mutedUserIds =
    mutedUserIdsForDelivery !== undefined
      ? new Set(mutedUserIdsForDelivery)
      : spaceId
        ? new Set(
            (
              await prisma.spaceNotificationPreference.findMany({
                where: {
                  spaceId,
                  muted: true,
                },
                select: {
                  userId: true,
                },
              })
            ).map((preference) => preference.userId),
          )
        : new Set<string>();

  const activeRecipients = recipients.filter((recipient) => !mutedUserIds.has(recipient.userId));

  activeRecipients.forEach((recipient) => {
    broadcastNotificationCreated({
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

  await Promise.allSettled(
    activeRecipients.map((recipient) => sendPushToUser(recipient.userId, notification.title, notification.body)),
  );

  return notification;
};
