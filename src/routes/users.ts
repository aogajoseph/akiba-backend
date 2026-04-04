import { Router } from 'express';

import {
  ApiResponse,
  DeleteAccountResponseDto,
  User,
} from '../../../shared/contracts';
import { ensureNonEmptyString } from '../utils/http';
import { getCurrentUserOrThrow } from '../utils/auth';
import { deleteCurrentUser } from '../services/userService';

const router = Router();

const getCurrentUser = async (headerValue: string | undefined): Promise<User> => {
  const userId = ensureNonEmptyString(headerValue, 'x-user-id header is required');
  return getCurrentUserOrThrow(userId);
};

router.delete('/me', async (req, res, next) => {
  try {
    const user = await getCurrentUser(req.header('x-user-id'));
    const userId = await deleteCurrentUser(user.id);

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
