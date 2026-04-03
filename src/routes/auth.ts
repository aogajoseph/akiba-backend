import { Router } from 'express';

import {
  ApiResponse,
  LoginRequestDto,
  LoginResponseDto,
  MeResponseDto,
  RegisterRequestDto,
  RegisterResponseDto,
  User,
} from '../../../shared/contracts';
import { users } from '../data/store';
import { prisma } from '../lib/prisma';
import {
  createHttpError,
  ensureNonEmptyString,
  getObjectBody,
} from '../utils/http';

const router = Router();

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

const isUniqueConstraintError = (error: unknown): boolean => {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'P2002'
  );
};

router.post('/register', async (req, res, next) => {
  try {
    const body = getObjectBody(req.body);
    const dto: RegisterRequestDto = {
      name: ensureNonEmptyString(body.name, 'Name is required'),
      phoneNumber: ensureNonEmptyString(body.phoneNumber, 'Phone Number is required'),
    };

    let createdUser;

    try {
      createdUser = await prisma.user.create({
        data: {
          name: dto.name,
          phone: dto.phoneNumber,
        },
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw createHttpError(409, 'A user with that phone number already exists');
      }

      throw error;
    }

    const user = mapDbUserToContractUser(createdUser);
    syncUserCache(user);

    const response: ApiResponse<RegisterResponseDto> = {
      data: {
        user,
        token: `token-${user.id}`,
      },
    };

    res.status(201).json(response);
  } catch (error) {
    next(error);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const body = getObjectBody(req.body);
    const dto: LoginRequestDto = {
      phoneNumber: ensureNonEmptyString(body.phoneNumber, 'Phone Number is required'),
    };

    const dbUser = await prisma.user.findUnique({
      where: {
        phone: dto.phoneNumber,
      },
    });

    if (!dbUser) {
      throw createHttpError(404, 'User not found');
    }

    const user = mapDbUserToContractUser(dbUser);
    syncUserCache(user);

    const response: ApiResponse<LoginResponseDto> = {
      data: {
        user,
        token: `token-${user.id}`,
      },
    };

    res.json(response);
  } catch (error) {
    next(error);
  }
});

router.get('/me', async (req, res, next) => {
  try {
    const userId = ensureNonEmptyString(req.header('x-user-id'), 'x-user-id header is required');
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

    const response: ApiResponse<MeResponseDto> = {
      data: {
        user,
      },
    };

    res.json(response);
  } catch (error) {
    next(error);
  }
});

export default router;
