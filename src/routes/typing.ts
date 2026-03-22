import { Request, Router } from 'express';

import {
  ApiResponse,
  Group,
  GroupMember,
  ListTypingUsersResponseDto,
  User,
} from '../../../shared/contracts';
import { groupMembers, groups, typingUsers, users } from '../data/store';
import { createHttpError, ensureNonEmptyString } from '../utils/http';

const router = Router({ mergeParams: true });

type TypingParams = {
  groupId?: string;
  spaceId?: string;
};

const getCurrentUser = (headerValue: string | undefined): User => {
  const userId = ensureNonEmptyString(headerValue, 'x-user-id header is required');
  const user = users.find((item) => item.id === userId);

  if (!user) {
    throw createHttpError(404, 'User not found');
  }

  return user;
};

const getSpaceId = (params: Record<string, string | undefined>): string => {
  return ensureNonEmptyString(params.spaceId ?? params.groupId, 'spaceId is required');
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

const getTypingSet = (spaceId: string): Set<string> => {
  if (!typingUsers[spaceId]) {
    typingUsers[spaceId] = new Set<string>();
  }

  return typingUsers[spaceId];
};

router.get('/', (req: Request<TypingParams>, res, next) => {
  try {
    const spaceId = getSpaceId(req.params);
    const user = getCurrentUser(req.header('x-user-id'));
    getGroupById(spaceId);
    requireMembership(spaceId, user.id);

    const response: ApiResponse<ListTypingUsersResponseDto> = {
      data: {
        users: Array.from(getTypingSet(spaceId))
          .map((userId) => {
            const typingUser = users.find((item) => item.id === userId);

            if (!typingUser) {
              return null;
            }

            return {
              userId: typingUser.id,
              name: typingUser.name,
            };
          })
          .filter((item): item is ListTypingUsersResponseDto['users'][number] => item !== null),
      },
    };

    res.json(response);
  } catch (error) {
    next(error);
  }
});

router.post('/start', (req: Request<TypingParams>, res, next) => {
  try {
    const spaceId = getSpaceId(req.params);
    const user = getCurrentUser(req.header('x-user-id'));
    getGroupById(spaceId);
    requireMembership(spaceId, user.id);

    getTypingSet(spaceId).add(user.id);

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

router.post('/stop', (req: Request<TypingParams>, res, next) => {
  try {
    const spaceId = getSpaceId(req.params);
    const user = getCurrentUser(req.header('x-user-id'));
    getGroupById(spaceId);
    requireMembership(spaceId, user.id);

    typingUsers[spaceId]?.delete(user.id);

    if (typingUsers[spaceId]?.size === 0) {
      delete typingUsers[spaceId];
    }

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

export default router;
