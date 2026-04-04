import { User } from '../../../shared/contracts';
import { users } from '../data/store';
import { prisma } from '../lib/prisma';
import { createHttpError } from './http';

type DbUserLike = {
  createdAt: Date;
  id: string;
  name: string | null;
  phone: string | null;
};

export const mapDbUserToContractUser = (user: DbUserLike): User => {
  return {
    id: user.id,
    name: user.name ?? '',
    phoneNumber: user.phone ?? '',
    createdAt: user.createdAt.toISOString(),
  };
};

const syncUserCache = (user: User): void => {
  const existingIndex = users.findIndex((item) => item.id === user.id);

  if (existingIndex >= 0) {
    users[existingIndex] = user;
    return;
  }

  users.push(user);
};

export const getCurrentUserOrThrow = async (userId: string): Promise<User> => {
  const dbUser = await prisma.user.findUnique({
    where: {
      id: userId,
    },
  });

  if (!dbUser) {
    throw createHttpError(404, 'User not found');
  }

  const user = mapDbUserToContractUser(dbUser);
  syncUserCache(user);

  return user;
};

export const getUserByPhoneNumber = async (phoneNumber: string): Promise<User | null> => {
  const dbUser = await prisma.user.findUnique({
    where: {
      phone: phoneNumber,
    },
  });

  if (!dbUser) {
    return null;
  }

  const user = mapDbUserToContractUser(dbUser);
  syncUserCache(user);

  return user;
};

export const getUsersByIds = async (userIds: string[]): Promise<Map<string, User>> => {
  const uniqueUserIds = Array.from(new Set(userIds.filter(Boolean)));

  if (uniqueUserIds.length === 0) {
    return new Map<string, User>();
  }

  const dbUsers = await prisma.user.findMany({
    where: {
      id: {
        in: uniqueUserIds,
      },
    },
  });

  return dbUsers.reduce<Map<string, User>>((userMap, dbUser) => {
    const user = mapDbUserToContractUser(dbUser);
    syncUserCache(user);
    userMap.set(user.id, user);
    return userMap;
  }, new Map<string, User>());
};
