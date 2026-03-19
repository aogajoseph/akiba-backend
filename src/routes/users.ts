import { Router } from 'express';

import {
  ApiResponse,
  DeleteAccountResponseDto,
  User,
} from '../../../shared/contracts';
import { users } from '../data/store';
import { createHttpError, ensureNonEmptyString } from '../utils/http';
import { deleteCurrentUser } from '../services/userService';

const router = Router();

const getCurrentUser = (headerValue: string | undefined): User => {
  const userId = ensureNonEmptyString(headerValue, 'x-user-id header is required');
  const user = users.find((item) => item.id === userId);

  if (!user) {
    throw createHttpError(404, 'User not found');
  }

  return user;
};

router.delete('/me', (req, res, next) => {
  try {
    const user = getCurrentUser(req.header('x-user-id'));
    const userId = deleteCurrentUser(user.id);

    const response: ApiResponse<DeleteAccountResponseDto> = {
      data: {
        userId,
      },
    };

    res.json(response);
  } catch (error) {
    next(error);
  }
});

export default router;
