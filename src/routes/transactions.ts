import { Router } from 'express';

import {
  ApiResponse,
  CreateDepositRequestDto,
  CreateDepositResponseDto,
  CreateWithdrawalRequestDto,
  CreateWithdrawalResponseDto,
  GetTransactionResponseDto,
  ListTransactionsResponseDto,
} from '../../../shared/contracts';
import {
  createDeposit,
  createWithdrawal,
  getTransaction,
  listTransactions,
} from '../services/transactionService';

const router = Router({ mergeParams: true });

const getCurrentUserId = (headerValue: string | undefined): string => {
  return headerValue ?? 'user_1';
};

router.post('/deposits', (req, res) => {
  try {
    const { groupId } = req.params;
    const userId = getCurrentUserId(req.header('x-user-id'));
    const dto = req.body as CreateDepositRequestDto;
    const transaction = createDeposit(groupId, userId, dto);

    const response: ApiResponse<CreateDepositResponseDto> = {
      data: {
        transaction,
      },
    };

    res.status(201).json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create deposit';
    res.status(400).json({ error: message });
  }
});

router.post('/withdrawals', (req, res) => {
  try {
    const { groupId } = req.params;
    const userId = getCurrentUserId(req.header('x-user-id'));
    const dto = req.body as CreateWithdrawalRequestDto;
    const transaction = createWithdrawal(groupId, userId, dto);

    const response: ApiResponse<CreateWithdrawalResponseDto> = {
      data: {
        transaction,
      },
    };

    res.status(201).json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create withdrawal';
    res.status(400).json({ error: message });
  }
});

router.get('/', (req, res) => {
  try {
    const { groupId } = req.params;
    const groupTransactions = listTransactions(groupId);
    const response: ApiResponse<ListTransactionsResponseDto> = {
      data: {
        transactions: groupTransactions,
      },
    };

    res.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to list transactions';
    res.status(400).json({ error: message });
  }
});

router.get('/:transactionId', (req, res) => {
  try {
    const { groupId, transactionId } = req.params;
    const transaction = getTransaction(groupId, transactionId);
    const response: ApiResponse<GetTransactionResponseDto> = {
      data: {
        transaction,
      },
    };

    res.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get transaction';
    res.status(404).json({ error: message });
  }
});

export default router;
