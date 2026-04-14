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
import { emitTypingUpdate } from '../services/chatRealtimeService';

const router = Router({ mergeParams: true });
const TYPING_TTL_MS = 5_000;

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

const getTypingUsersMap = (spaceId: string): Map<string, number> => {
  if (!typingUsers[spaceId]) {
    typingUsers[spaceId] = new Map<string, number>();
  }

  const activeTypingUsers = typingUsers[spaceId];
  const now = Date.now();

  for (const [userId, lastSeenAt] of activeTypingUsers.entries()) {
    if (now - lastSeenAt > TYPING_TTL_MS) {
      activeTypingUsers.delete(userId);
    }
  }

  if (activeTypingUsers.size === 0) {
    delete typingUsers[spaceId];
    return new Map<string, number>();
  }

  return activeTypingUsers;
};

const listActiveTypingUsers = async (spaceId: string): Promise<ListTypingUsersResponseDto['users']> => {
  const typingUserIds = Array.from(getTypingUsersMap(spaceId).keys());
  const usersById = await getUsersByIds(typingUserIds);

  return typingUserIds
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
    .filter((item): item is ListTypingUsersResponseDto['users'][number] => item !== null);
};

router.get('/', async (req: Request<TypingParams>, res, next) => {
  try {
    const spaceId = getSpaceId(req.params);
    const user = await getCurrentUser(req.header('x-user-id'));
    await getSpaceById(spaceId);
    await requireMembership(spaceId, user.id);

    const response: ApiResponse<ListTypingUsersResponseDto> = {
      data: {
        users: await listActiveTypingUsers(spaceId),
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

    getTypingUsersMap(spaceId).set(user.id, Date.now());
    emitTypingUpdate({
      spaceId,
      users: await listActiveTypingUsers(spaceId),
    });

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

    getTypingUsersMap(spaceId).delete(user.id);

    if (!typingUsers[spaceId] || typingUsers[spaceId].size === 0) {
      delete typingUsers[spaceId];
    }

    emitTypingUpdate({
      spaceId,
      users: await listActiveTypingUsers(spaceId),
    });

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

export default router;
