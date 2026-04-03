import { User } from '../../../shared/contracts';
import { users } from '../data/store';
import { prisma } from '../lib/prisma';
import { createHttpError } from './http';

const mapDbUserToContractUser = (user: {
  createdAt: Date;
  id: string;
  name: string | null;
  phone: string | null;
}): User => {
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
