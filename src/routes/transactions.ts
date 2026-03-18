import { Router } from 'express';

import {
  ApiResponse,
  CreateDepositResponseDto,
  CreateWithdrawalResponseDto,
  GetTransactionResponseDto,
  ListTransactionsResponseDto,
  TransactionType,
} from '../../../shared/contracts';
import { transactions } from '../data/store';

const router = Router({ mergeParams: true });

router.post('/deposits', (req, res) => {
  const transaction =
    transactions.find(
      (item) => item.groupId === req.params.groupId && item.type === TransactionType.DEPOSIT,
    ) ?? transactions[0];

  const response: ApiResponse<CreateDepositResponseDto> = {
    data: {
      transaction,
    },
  };

  res.status(201).json(response);
});

router.post('/withdrawals', (req, res) => {
  const transaction =
    transactions.find(
      (item) => item.groupId === req.params.groupId && item.type === TransactionType.WITHDRAWAL,
    ) ?? transactions[0];

  const response: ApiResponse<CreateWithdrawalResponseDto> = {
    data: {
      transaction,
    },
  };

  res.status(201).json(response);
});

router.get('/', (req, res) => {
  const groupTransactions = transactions.filter((item) => item.groupId === req.params.groupId);
  const response: ApiResponse<ListTransactionsResponseDto> = {
    data: {
      transactions: groupTransactions.length > 0 ? groupTransactions : transactions,
    },
  };

  res.json(response);
});

router.get('/:transactionId', (req, res) => {
  const transaction = transactions.find((item) => item.id === req.params.transactionId) ?? transactions[0];
  const response: ApiResponse<GetTransactionResponseDto> = {
    data: {
      transaction,
    },
  };

  res.json(response);
});

export default router;
