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
import {
  createHttpError,
  createId,
  ensureNonEmptyString,
  getObjectBody,
} from '../utils/http';

const router = Router();

const getUserById = (userId: string): User | undefined => {
  return users.find((item) => item.id === userId);
};

router.post('/register', (req, res, next) => {
  try {
    const body = getObjectBody(req.body);
    const dto: RegisterRequestDto = {
      name: ensureNonEmptyString(body.name, 'name is required'),
      phoneNumber: ensureNonEmptyString(body.phoneNumber, 'phoneNumber is required'),
    };

    const existingUser = users.find((item) => item.phoneNumber === dto.phoneNumber);
    if (existingUser) {
      throw createHttpError(409, 'A user with that phone number already exists');
    }

    const user: User = {
      id: createId('user'),
      name: dto.name,
      phoneNumber: dto.phoneNumber,
      createdAt: new Date().toISOString(),
    };

    users.push(user);

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

router.post('/login', (req, res, next) => {
  try {
    const body = getObjectBody(req.body);
    const dto: LoginRequestDto = {
      phoneNumber: ensureNonEmptyString(body.phoneNumber, 'phoneNumber is required'),
    };

    const user = users.find((item) => item.phoneNumber === dto.phoneNumber);
    if (!user) {
      throw createHttpError(404, 'User not found');
    }

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

router.get('/me', (req, res, next) => {
  try {
    const userId = ensureNonEmptyString(req.header('x-user-id'), 'x-user-id header is required');
    const user = getUserById(userId);

    if (!user) {
      throw createHttpError(404, 'User not found');
    }

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
