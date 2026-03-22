import { Request, Router } from 'express';

import {
  ApiResponse,
  CreateMessageRequestDto,
  CreateMessageResponseDto,
  DeleteMessageResponseDto,
  Group,
  GroupMember,
  ListMessagesResponseDto,
  Message,
  ToggleMessageReactionRequestDto,
  ToggleMessageReactionResponseDto,
  User,
} from '../../../shared/contracts';
import { groupMembers, groups, messages, users } from '../data/store';
import {
  createHttpError,
  createId,
  ensureNonEmptyString,
  ensureOptionalNonEmptyString,
  getObjectBody,
} from '../utils/http';

const router = Router({ mergeParams: true });

type GroupParams = {
  groupId: string;
};

type MessageParams = {
  groupId: string;
  messageId: string;
};

const getCurrentUser = (headerValue: string | undefined): User => {
  const userId = ensureNonEmptyString(headerValue, 'x-user-id header is required');
  const user = users.find((item) => item.id === userId);

  if (!user) {
    throw createHttpError(404, 'User not found');
  }

  return user;
};

const getGroupById = (groupId: string): Group => {
  const group = groups.find((item) => item.id === groupId);

  if (!group) {
    throw createHttpError(404, 'Group not found');
  }

  return group;
};

const requireMembership = (groupId: string, userId: string): GroupMember => {
  const membership = groupMembers.find(
    (item) => item.groupId === groupId && item.userId === userId,
  );

  if (!membership) {
    throw createHttpError(403, 'You are not a member of this group');
  }

  return membership;
};

router.get('/', (req: Request<GroupParams>, res, next) => {
  try {
    const { groupId } = req.params;
    const user = getCurrentUser(req.header('x-user-id'));
    getGroupById(groupId);
    requireMembership(groupId, user.id);

    const response: ApiResponse<ListMessagesResponseDto> = {
      data: {
        messages: messages
          .filter((item) => item.groupId === groupId)
          .map((item) => ({
            ...item,
            reactions: item.reactions ?? [],
            status: item.status ?? 'sent',
          })),
      },
    };

    res.json(response);
  } catch (error) {
    next(error);
  }
});

router.post('/', (req: Request<GroupParams>, res, next) => {
  try {
    const { groupId } = req.params;
    const user = getCurrentUser(req.header('x-user-id'));
    getGroupById(groupId);
    requireMembership(groupId, user.id);
    const body = getObjectBody(req.body);
    const dto: CreateMessageRequestDto = {
      text: ensureNonEmptyString(body.text, 'text is required'),
      replyToMessageId: ensureOptionalNonEmptyString(
        body.replyToMessageId,
        'replyToMessageId must be a non-empty string',
      ),
    };

    if (
      dto.replyToMessageId &&
      !messages.some((item) => item.groupId === groupId && item.id === dto.replyToMessageId)
    ) {
      throw createHttpError(404, 'Reply target message not found');
    }

    const message: Message = {
      id: createId('message'),
      groupId,
      senderUserId: user.id,
      text: dto.text,
      replyToMessageId: dto.replyToMessageId,
      reactions: [],
      status: 'sent',
      createdAt: new Date().toISOString(),
    };

    messages.push(message);

    const response: ApiResponse<CreateMessageResponseDto> = {
      data: {
        message,
      },
    };

    res.status(201).json(response);
  } catch (error) {
    next(error);
  }
});

router.post('/:messageId/reactions', (req: Request<MessageParams>, res, next) => {
  try {
    const { groupId, messageId } = req.params;
    const user = getCurrentUser(req.header('x-user-id'));
    getGroupById(groupId);
    requireMembership(groupId, user.id);

    const body = getObjectBody(req.body);
    const dto: ToggleMessageReactionRequestDto = {
      emoji: ensureNonEmptyString(body.emoji, 'emoji is required'),
    };

    const message = messages.find((item) => item.groupId === groupId && item.id === messageId);

    if (!message) {
      throw createHttpError(404, 'Message not found');
    }

    message.reactions = message.reactions ?? [];

    const reaction = message.reactions.find((item) => item.emoji === dto.emoji);

    if (reaction?.userIds.includes(user.id)) {
      reaction.userIds = reaction.userIds.filter((userId) => userId !== user.id);
    } else if (reaction) {
      reaction.userIds.push(user.id);
    } else {
      message.reactions.push({
        emoji: dto.emoji,
        userIds: [user.id],
      });
    }

    message.reactions = message.reactions.filter((item) => item.userIds.length > 0);

    const response: ApiResponse<ToggleMessageReactionResponseDto> = {
      data: {
        message,
      },
    };

    res.json(response);
  } catch (error) {
    next(error);
  }
});

router.delete('/:messageId', (req: Request<MessageParams>, res, next) => {
  try {
    const { groupId, messageId } = req.params;
    const user = getCurrentUser(req.header('x-user-id'));
    getGroupById(groupId);
    requireMembership(groupId, user.id);

    const messageIndex = messages.findIndex(
      (item) => item.groupId === groupId && item.id === messageId,
    );

    if (messageIndex < 0) {
      throw createHttpError(404, 'Message not found');
    }

    if (messages[messageIndex].senderUserId !== user.id) {
      throw createHttpError(403, 'You can only delete your own messages');
    }

    messages.splice(messageIndex, 1);

    const response: ApiResponse<DeleteMessageResponseDto> = {
      data: {
        success: true,
      },
    };

    res.json(response);
  } catch (error) {
    next(error);
  }
});

export default router;
