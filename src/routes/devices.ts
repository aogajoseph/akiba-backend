import { Request, Router } from 'express';

import {
  ApiResponse,
  RegisterDeviceRequestDto,
  RegisterDeviceResponseDto,
  User,
} from '../../../shared/contracts';
import { registerDeviceToken } from '../services/deviceService';
import { getCurrentUserOrThrow } from '../utils/auth';
import { ensureNonEmptyString } from '../utils/http';

const router = Router();

const getCurrentUser = async (headerValue: string | undefined): Promise<User> => {
  const userId = ensureNonEmptyString(headerValue, 'x-user-id header is required');
  return getCurrentUserOrThrow(userId);
};

router.post('/', async (req: Request<unknown, unknown, RegisterDeviceRequestDto>, res, next) => {
  try {
    const user = await getCurrentUser(req.header('x-user-id'));
    const token = ensureNonEmptyString(req.body?.token, 'token is required');

    const result = await registerDeviceToken({
      userId: user.id,
      token,
    });

    const response: ApiResponse<RegisterDeviceResponseDto> = {
      data: result,
    };

    res.json(response);
  } catch (error) {
    next(error);
  }
});

export default router;
