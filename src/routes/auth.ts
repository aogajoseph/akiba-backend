import { Router } from 'express';

import {
  ApiResponse,
  LoginResponseDto,
  MeResponseDto,
  RegisterResponseDto,
} from '../../../shared/contracts';
import { users } from '../data/store';

const router = Router();

router.post('/register', (_req, res) => {
  const response: ApiResponse<RegisterResponseDto> = {
    data: {
      user: users[0],
      token: 'mock-token',
    },
  };

  res.status(201).json(response);
});

router.post('/login', (_req, res) => {
  const response: ApiResponse<LoginResponseDto> = {
    data: {
      user: users[0],
      token: 'mock-token',
    },
  };

  res.json(response);
});

router.get('/me', (_req, res) => {
  const response: ApiResponse<MeResponseDto> = {
    data: {
      user: users[0],
    },
  };

  res.json(response);
});

export default router;
