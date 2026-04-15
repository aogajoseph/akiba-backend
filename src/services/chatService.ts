import { MessageStatus, type Message as ContractMessage, type MessageMedia } from '../../../shared/contracts';
import { prisma } from '../lib/prisma';
import {
  emitMessageCreated,
  emitMessageDeleted,
  emitReactionUpdated,
} from './chatRealtimeService';
import { createHttpError } from '../utils/http';

const normalizeMessageMedia = (media?: MessageMedia[]): MessageMedia[] | undefined => {
  if (!media?.length) {
    return undefined;
  }

  return media.map((item) => {
    const normalizedUrl = item.url.trim();

    if (!normalizedUrl) {
      throw createHttpError(400, 'Media URL is required');
    }

    if (item.type !== 'image' && item.type !== 'video') {
      throw createHttpError(400, 'Media type must be image or video');
    }

    return {
      type: item.type,
      url: normalizedUrl,
    };
  });
};

const ensureSpaceMembership = async (spaceId: string, userId: string) => {
  const [space, membership] = await Promise.all([
    prisma.space.findUnique({
      where: {
        id: spaceId,
      },
    }),
    prisma.spaceMember.findFirst({
      where: {
        spaceId,
        userId,
      },
    }),
  ]);

  if (!space) {
    throw createHttpError(404, 'Group not found');
  }

  if (!membership) {
    throw createHttpError(403, 'You are not a member of this group');
  }
};

const ensureReplyTargetInSpace = async (
  spaceId: string,
  replyToMessageId: string | undefined,
  tx: typeof prisma = prisma,
): Promise<void> => {
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
    throw createHttpError(404, 'Reply target message not found');
  }
};

const mapDbMessageToContractMessage = (message: {
  attachments: Array<{
    type: string;
    url: string;
  }>;
  createdAt: Date;
  id: string;
  reactions: Array<{
    emoji: string;
    userId: string;
  }>;
  replyToId: string | null;
  spaceId: string;
  status: string;
  text: string;
  userId: string;
}): ContractMessage => {
  const reactionsByEmoji = new Map<string, string[]>();

  for (const reaction of message.reactions) {
    const userIds = reactionsByEmoji.get(reaction.emoji) ?? [];
    userIds.push(reaction.userId);
    reactionsByEmoji.set(reaction.emoji, userIds);
  }

  const media: MessageMedia[] = message.attachments.map((attachment) => ({
    type: attachment.type as MessageMedia['type'],
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
    status: (message.status as MessageStatus) ?? 'sent',
    createdAt: message.createdAt.toISOString(),
  };
};

const getMessageByIdOrThrow = async (spaceId: string, messageId: string) => {
  const message = await prisma.message.findFirst({
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
    throw createHttpError(404, 'Message not found');
  }

  return message;
};

export const listMessages = async (
  spaceId: string,
  userId: string,
  options?: {
    cursor?: string;
    limit?: number;
    since?: Date;
  },
): Promise<{ messages: ContractMessage[]; nextCursor?: string }> => {
  await ensureSpaceMembership(spaceId, userId);

  const normalizedLimit = Math.min(Math.max(options?.limit ?? 20, 1), 50);
  const shouldPaginate = !options?.since || Boolean(options?.cursor);
  let cursorMessage:
    | {
        createdAt: Date;
        id: string;
      }
    | null = null;

  if (options?.cursor) {
    cursorMessage = await prisma.message.findFirst({
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

  const messages = await prisma.message.findMany({
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

export const createMessage = async (input: {
  media?: MessageMedia[];
  replyToMessageId?: string;
  spaceId: string;
  text?: string;
  userId: string;
}): Promise<ContractMessage> => {
  await ensureSpaceMembership(input.spaceId, input.userId);
  await ensureReplyTargetInSpace(input.spaceId, input.replyToMessageId);
  const normalizedMedia = normalizeMessageMedia(input.media);

  const createdMessage = await prisma.message.create({
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
  emitMessageCreated({
    spaceId: input.spaceId,
    message,
  });

  return message;
};

export const toggleMessageReaction = async (input: {
  emoji: string;
  messageId: string;
  spaceId: string;
  userId: string;
}): Promise<ContractMessage> => {
  await ensureSpaceMembership(input.spaceId, input.userId);
  await getMessageByIdOrThrow(input.spaceId, input.messageId);

  const existingReaction = await prisma.messageReaction.findUnique({
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
    await prisma.messageReaction.delete({
      where: {
        id: existingReaction.id,
      },
    });
  } else {
    await prisma.messageReaction.create({
      data: {
        messageId: input.messageId,
        userId: input.userId,
        emoji: input.emoji,
      },
    });
  }

  const updatedMessage = await getMessageByIdOrThrow(input.spaceId, input.messageId);
  const message = mapDbMessageToContractMessage(updatedMessage);
  emitReactionUpdated({
    spaceId: input.spaceId,
    message,
  });

  return message;
};

export const deleteMessage = async (input: {
  messageId: string;
  spaceId: string;
  userId: string;
}): Promise<void> => {
  await ensureSpaceMembership(input.spaceId, input.userId);

  const message = await prisma.message.findFirst({
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
    throw createHttpError(404, 'Message not found');
  }

  if (message.userId !== input.userId) {
    throw createHttpError(403, 'You can only delete your own messages');
  }

  await prisma.$transaction(async (tx) => {
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

  emitMessageDeleted({
    spaceId: input.spaceId,
    messageId: message.id,
  });
};
