import { Request, Router } from 'express';

import {
  ApiResponse,
  GetNotificationsResponse,
  MarkNotificationReadResponse,
  User,
} from '../../../shared/contracts';
import { getCurrentUserOrThrow } from '../utils/auth';
import {
  createHttpError,
  ensureNonEmptyString,
  ensurePositiveInteger,
} from '../utils/http';
import {
  getUserNotifications,
  markNotificationAsRead,
} from '../services/notificationQueryService';

const router = Router();

const getCurrentUser = async (headerValue: string | undefined): Promise<User> => {
  const userId = ensureNonEmptyString(headerValue, 'x-user-id header is required');
  return getCurrentUserOrThrow(userId);
};

router.get('/', async (req: Request, res, next) => {
  try {
    const user = await getCurrentUser(req.header('x-user-id'));
    const cursor =
      req.query.cursor === undefined
        ? undefined
        : ensureNonEmptyString(req.query.cursor, 'cursor must be a non-empty string');
    const limit =
      req.query.limit === undefined
        ? 20
        : ensurePositiveInteger(Number(req.query.limit), 'limit must be a positive integer');

    if (limit > 100) {
      throw createHttpError(400, 'limit cannot exceed 100');
    }

    const result = await getUserNotifications({
      userId: user.id,
      cursor,
      limit,
    });

    const response: ApiResponse<GetNotificationsResponse> = {
      data: result,
    };

    res.json(response);
  } catch (error) {
    next(error);
  }
});

router.patch('/:id/read', async (req: Request<{ id: string }>, res, next) => {
  try {
    const user = await getCurrentUser(req.header('x-user-id'));
    const notificationId = ensureNonEmptyString(req.params.id, 'notification id is required');

    const result = await markNotificationAsRead({
      userId: user.id,
      notificationId,
    });

    const response: ApiResponse<MarkNotificationReadResponse> = {
      data: result,
    };

    res.json(response);
  } catch (error) {
    next(error);
  }
});

export default router;
