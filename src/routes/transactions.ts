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
  GroupRole,
  ListTransactionsResponseDto,
  Transaction,
  TransactionSource,
  User,
} from '../../../shared/contracts';
import { prisma } from '../lib/prisma';
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

const getGroupById = async (groupId: string): Promise<Group> => {
  const space = await prisma.space.findUnique({
    where: {
      id: groupId,
    },
  });

  if (!space) {
    throw createHttpError(404, 'Group not found');
  }

  return {
    id: space.id,
    name: space.name,
    description: space.description ?? undefined,
    imageUrl: space.imageUrl ?? undefined,
    paybillNumber: space.paybillNumber ?? process.env.MPESA_PAYBILL?.trim() ?? '522522',
    accountNumber: space.accountNumber ?? '',
    targetAmount: space.targetAmount ?? undefined,
    collectedAmount: 0,
    deadline: space.deadline?.toISOString(),
    createdByUserId: space.createdById,
    approvalThreshold: 2,
    createdAt: space.createdAt.toISOString(),
  };
};

const requireMembership = async (groupId: string, userId: string): Promise<GroupMember> => {
  const membership = await prisma.spaceMember.findFirst({
    where: {
      spaceId: groupId,
      userId,
    },
  });

  if (!membership) {
    throw createHttpError(403, 'You are not a member of this group');
  }

  return {
    id: membership.id,
    groupId: membership.spaceId,
    userId: membership.userId,
    role: membership.role === 'admin' ? GroupRole.SIGNATORY : GroupRole.MEMBER,
    signatoryRole: membership.role === 'admin' ? 'primary' : null,
    joinedAt: membership.createdAt.toISOString(),
  };
};

const parseDepositDto = (body: Record<string, unknown>): CreateDepositRequestDto => {
  return {
    spaceId: ensureNonEmptyString(body.spaceId, 'spaceId is required'),
    amount: ensurePositiveNumber(body.amount, 'amount must be a positive number'),
    source: ensureNonEmptyString(body.source, 'source is required') as TransactionSource,
    phoneNumber:
      body.phoneNumber === undefined
        ? undefined
        : ensureNonEmptyString(body.phoneNumber, 'phoneNumber must be a non-empty string'),
  };
};

const parseWithdrawalDto = (body: Record<string, unknown>): CreateWithdrawalRequestDto => {
  return {
    amount: ensurePositiveNumber(body.amount, 'amount must be a positive number'),
    recipientPhoneNumber: ensureNonEmptyString(
      body.recipientPhoneNumber,
      'recipientPhoneNumber is required',
    ),
    recipientName: ensureNonEmptyString(body.recipientName, 'recipientName is required'),
    reason: ensureNonEmptyString(body.reason, 'reason is required'),
    currency:
      body.currency === undefined
        ? undefined
        : ensureNonEmptyString(body.currency, 'currency must be a non-empty string'),
    description:
      body.description === undefined
        ? undefined
        : ensureNonEmptyString(body.description, 'description must be a non-empty string'),
    destination:
      body.destination === undefined
        ? undefined
        : ensureNonEmptyString(body.destination, 'destination must be a non-empty string'),
  };
};

const requireTransaction = async (
  groupId: string,
  transactionId: string,
): Promise<Transaction> => {
  const transaction = await getTransaction(groupId, transactionId);

  if (!transaction) {
    throw createHttpError(404, 'Transaction not found');
  }

  return transaction;
};

router.post('/deposits', async (req: Request<GroupParams>, res, next) => {
  try {
    const { groupId } = req.params;
    const user = await getCurrentUser(req.header('x-user-id'));
    await getGroupById(groupId);
    await requireMembership(groupId, user.id);
    const dto = parseDepositDto(getObjectBody(req.body));

    if (dto.spaceId !== groupId) {
      throw createHttpError(400, 'spaceId does not match route parameter');
    }

    const transaction = await createDeposit(groupId, user.id, dto);

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
    await getGroupById(groupId);
    await requireMembership(groupId, user.id);
    const dto = parseWithdrawalDto(getObjectBody(req.body));
    const transaction = await createWithdrawal(groupId, user.id, dto);

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
    await getGroupById(groupId);
    await requireMembership(groupId, user.id);

    const response: ApiResponse<ListTransactionsResponseDto> = {
      data: {
        transactions: await listTransactions(groupId),
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
    await getGroupById(groupId);
    await requireMembership(groupId, user.id);

    const response: ApiResponse<GetTransactionsSummaryResponseDto> = {
      data: await getTransactionsSummary(groupId),
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
    await getGroupById(groupId);
    await requireMembership(groupId, user.id);
    const transaction = await requireTransaction(groupId, transactionId);

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
