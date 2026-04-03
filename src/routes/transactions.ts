import { Request, Router } from 'express';

import {
  ApiResponse,
  CreateDepositRequestDto,
  CreateDepositResponseDto,
  CreateWithdrawalRequestDto,
  CreateWithdrawalResponseDto,
  GetTransactionResponseDto,
  GetTransactionsSummaryResponseDto,
  Group,
  GroupMember,
  ListTransactionsResponseDto,
  Transaction,
  User,
} from '../../../shared/contracts';
import { groupMembers, groups } from '../data/store';
import {
  createHttpError,
  ensureNonEmptyString,
  ensurePositiveNumber,
  getObjectBody,
} from '../utils/http';
import { getCurrentUserOrThrow } from '../utils/auth';
import {
  createDeposit,
  createWithdrawal,
  getTransaction,
  getTransactionsSummary,
  listTransactions,
} from '../services/transactionService';

const router = Router({ mergeParams: true });

type GroupParams = {
  groupId: string;
};

type TransactionParams = {
  groupId: string;
  transactionId: string;
};

const getCurrentUser = async (headerValue: string | undefined): Promise<User> => {
  const userId = ensureNonEmptyString(headerValue, 'x-user-id header is required');
  return getCurrentUserOrThrow(userId);
};

const getGroupById = (groupId: string): Group => {
  const group = groups.find((item) => item.id === groupId);

  if (!group) {
    throw createHttpError(404, 'Group not found');
  }

  return group;
};

const requireMembership = (groupId: string, userId: string): GroupMember => {
  const membership = groupMembers.find(
    (item) => item.groupId === groupId && item.userId === userId,
  );

  if (!membership) {
    throw createHttpError(403, 'You are not a member of this group');
  }

  return membership;
};

const parseDepositDto = (body: Record<string, unknown>): CreateDepositRequestDto => {
  return {
    amount: ensurePositiveNumber(body.amount, 'amount must be a positive number'),
    currency: ensureNonEmptyString(body.currency, 'currency is required'),
    description:
      body.description === undefined
        ? undefined
        : ensureNonEmptyString(body.description, 'description must be a non-empty string'),
  };
};

const parseWithdrawalDto = (body: Record<string, unknown>): CreateWithdrawalRequestDto => {
  return {
    amount: ensurePositiveNumber(body.amount, 'amount must be a positive number'),
    currency: ensureNonEmptyString(body.currency, 'currency is required'),
    description:
      body.description === undefined
        ? undefined
        : ensureNonEmptyString(body.description, 'description must be a non-empty string'),
    destination: ensureNonEmptyString(body.destination, 'destination is required'),
  };
};

const requireTransaction = (groupId: string, transactionId: string): Transaction => {
  const transaction = getTransaction(groupId, transactionId);

  if (!transaction) {
    throw createHttpError(404, 'Transaction not found');
  }

  return transaction;
};

router.post('/deposits', async (req: Request<GroupParams>, res, next) => {
  try {
    const { groupId } = req.params;
    const user = await getCurrentUser(req.header('x-user-id'));
    getGroupById(groupId);
    requireMembership(groupId, user.id);
    const dto = parseDepositDto(getObjectBody(req.body));
    const transaction = createDeposit(groupId, user.id, dto);

    const response: ApiResponse<CreateDepositResponseDto> = {
      data: {
        transaction,
      },
    };

    res.status(201).json(response);
  } catch (error) {
    next(error);
  }
});

router.post('/withdrawals', async (req: Request<GroupParams>, res, next) => {
  try {
    const { groupId } = req.params;
    const user = await getCurrentUser(req.header('x-user-id'));
    getGroupById(groupId);
    requireMembership(groupId, user.id);
    const dto = parseWithdrawalDto(getObjectBody(req.body));
    const transaction = createWithdrawal(groupId, user.id, dto);

    const response: ApiResponse<CreateWithdrawalResponseDto> = {
      data: {
        transaction,
      },
    };

    res.status(201).json(response);
  } catch (error) {
    next(error);
  }
});

router.get('/', async (req: Request<GroupParams>, res, next) => {
  try {
    const { groupId } = req.params;
    const user = await getCurrentUser(req.header('x-user-id'));
    getGroupById(groupId);
    requireMembership(groupId, user.id);

    const response: ApiResponse<ListTransactionsResponseDto> = {
      data: {
        transactions: listTransactions(groupId),
      },
    };

    res.json(response);
  } catch (error) {
    next(error);
  }
});

router.get('/summary', async (req: Request<GroupParams>, res, next) => {
  try {
    const { groupId } = req.params;
    const user = await getCurrentUser(req.header('x-user-id'));
    getGroupById(groupId);
    requireMembership(groupId, user.id);

    const response: ApiResponse<GetTransactionsSummaryResponseDto> = {
      data: getTransactionsSummary(groupId),
    };

    res.json(response);
  } catch (error) {
    next(error);
  }
});

router.get('/:transactionId', async (req: Request<TransactionParams>, res, next) => {
  try {
    const { groupId, transactionId } = req.params;
    const user = await getCurrentUser(req.header('x-user-id'));
    getGroupById(groupId);
    requireMembership(groupId, user.id);
    const transaction = requireTransaction(groupId, transactionId);

    const response: ApiResponse<GetTransactionResponseDto> = {
      data: {
        transaction,
      },
    };

    res.json(response);
  } catch (error) {
    next(error);
  }
});

export default router;
