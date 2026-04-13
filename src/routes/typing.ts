import { Request, Router } from 'express';

import {
  ApiResponse,
  ListTypingUsersResponseDto,
  User,
} from '../../../shared/contracts';
import { typingUsers } from '../data/store';
import { prisma } from '../lib/prisma';
import { createHttpError, ensureNonEmptyString } from '../utils/http';
import { getCurrentUserOrThrow, getUsersByIds } from '../utils/auth';

const router = Router({ mergeParams: true });

type TypingParams = {
  groupId?: string;
  spaceId?: string;
};

const getCurrentUser = async (headerValue: string | undefined): Promise<User> => {
  const userId = ensureNonEmptyString(headerValue, 'x-user-id header is required');
  return getCurrentUserOrThrow(userId);
};

const getSpaceId = (params: Record<string, string | undefined>): string => {
  return ensureNonEmptyString(params.spaceId ?? params.groupId, 'spaceId is required');
};

const getSpaceById = async (spaceId: string) => {
  const space = await prisma.space.findUnique({
    where: {
      id: spaceId,
    },
  });

  if (!space) {
    throw createHttpError(404, 'Group not found');
  }

  return space;
};

const requireMembership = async (spaceId: string, userId: string) => {
  const membership = await prisma.spaceMember.findFirst({
    where: {
      spaceId,
      userId,
    },
  });

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

router.get('/', async (req: Request<TypingParams>, res, next) => {
  try {
    const spaceId = getSpaceId(req.params);
    const user = await getCurrentUser(req.header('x-user-id'));
    await getSpaceById(spaceId);
    await requireMembership(spaceId, user.id);
    const typingUserIds = Array.from(getTypingSet(spaceId));
    const usersById = await getUsersByIds(typingUserIds);

    const response: ApiResponse<ListTypingUsersResponseDto> = {
      data: {
        users: typingUserIds
          .map((userId) => {
            const typingUser = usersById.get(userId);

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

router.post('/start', async (req: Request<TypingParams>, res, next) => {
  try {
    const spaceId = getSpaceId(req.params);
    const user = await getCurrentUser(req.header('x-user-id'));
    await getSpaceById(spaceId);
    await requireMembership(spaceId, user.id);

    getTypingSet(spaceId).add(user.id);

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

router.post('/stop', async (req: Request<TypingParams>, res, next) => {
  try {
    const spaceId = getSpaceId(req.params);
    const user = await getCurrentUser(req.header('x-user-id'));
    await getSpaceById(spaceId);
    await requireMembership(spaceId, user.id);

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
