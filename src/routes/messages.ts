import { Router } from 'express';

import {
  ApiResponse,
  CreateMessageResponseDto,
  ListMessagesResponseDto,
} from '../../../shared/contracts';
import { messages } from '../data/store';

const router = Router({ mergeParams: true });

router.get('/', (req, res) => {
  const groupMessages = messages.filter((item) => item.groupId === req.params.groupId);
  const response: ApiResponse<ListMessagesResponseDto> = {
    data: {
      messages: groupMessages.length > 0 ? groupMessages : messages,
    },
  };

  res.json(response);
});

router.post('/', (req, res) => {
  const message = messages.find((item) => item.groupId === req.params.groupId) ?? messages[0];
  const response: ApiResponse<CreateMessageResponseDto> = {
    data: {
      message,
    },
  };

  res.status(201).json(response);
});

export default router;
