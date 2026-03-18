import { Router } from 'express';

import {
  ApiResponse,
  CreateMessageRequestDto,
  CreateMessageResponseDto,
  Group,
  GroupMember,
  ListMessagesResponseDto,
  Message,
  User,
} from '../../../shared/contracts';
import { groupMembers, groups, messages, users } from '../data/store';
import {
  createHttpError,
  createId,
  ensureNonEmptyString,
  getObjectBody,
} from '../utils/http';

const router = Router({ mergeParams: true });

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

router.get('/', (req, res, next) => {
  try {
    const { groupId } = req.params;
    const user = getCurrentUser(req.header('x-user-id'));
    getGroupById(groupId);
    requireMembership(groupId, user.id);

    const response: ApiResponse<ListMessagesResponseDto> = {
      data: {
        messages: messages.filter((item) => item.groupId === groupId),
      },
    };

    res.json(response);
  } catch (error) {
    next(error);
  }
});

router.post('/', (req, res, next) => {
  try {
    const { groupId } = req.params;
    const user = getCurrentUser(req.header('x-user-id'));
    getGroupById(groupId);
    requireMembership(groupId, user.id);
    const body = getObjectBody(req.body);
    const dto: CreateMessageRequestDto = {
      text: ensureNonEmptyString(body.text, 'text is required'),
    };

    const message: Message = {
      id: createId('message'),
      groupId,
      senderUserId: user.id,
      text: dto.text,
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

export default router;
