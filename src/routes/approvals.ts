import { Request, Router } from 'express';

import {
  ApiResponse,
  ApprovalStatus,
  CreateApprovalRequestDto,
  CreateApprovalResponseDto,
  ListApprovalsResponseDto,
  Transaction,
  TransactionType,
  User,
} from '../../../shared/contracts';
import { prisma } from '../lib/prisma';
import {
  createHttpError,
  ensureEnumValue,
  ensureNonEmptyString,
  getObjectBody,
} from '../utils/http';
import { getCurrentUserOrThrow } from '../utils/auth';
import { getTransaction } from '../services/transactionService';
import { approveWithdrawal, rejectWithdrawal } from '../services/groupService';
import { getApprovalByTransactionAndAdmin, listApprovals } from '../services/approvalService';

const router = Router({ mergeParams: true });

type ApprovalParams = {
  groupId: string;
  transactionId: string;
};

const getCurrentUser = async (headerValue: string | undefined): Promise<User> => {
  const userId = ensureNonEmptyString(headerValue, 'x-user-id header is required');
  return getCurrentUserOrThrow(userId);
};

const getGroupById = async (groupId: string) => {
  const group = await prisma.space.findUnique({
    where: {
      id: groupId,
    },
  });

  if (!group) {
    throw createHttpError(404, 'Group not found');
  }

  return group;
};

const requireMembership = async (groupId: string, userId: string) => {
  const membership = await prisma.spaceMember.findFirst({
    where: {
      spaceId: groupId,
      userId,
    },
  });

  if (!membership) {
    throw createHttpError(403, 'You are not a member of this group');
  }

  return membership;
};

const requireTransactionById = async (transactionId: string): Promise<Transaction> => {
  const transaction = await prisma.transaction.findUnique({
    where: {
      id: transactionId,
    },
  });

  if (!transaction) {
    throw createHttpError(404, 'Transaction not found');
  }

  return {
    id: transaction.id,
    spaceId: transaction.spaceId,
    userId: transaction.userId ?? undefined,
    type: transaction.type as TransactionType,
    amount: Number(transaction.amount),
    reference: transaction.reference,
    source: transaction.source,
    phoneNumber: transaction.phoneNumber ?? undefined,
    externalName: transaction.externalName ?? undefined,
    recipientPhoneNumber: transaction.recipientPhoneNumber ?? undefined,
    recipientName: transaction.recipientName ?? undefined,
    status: transaction.status as Transaction['status'],
    createdAt: transaction.createdAt.toISOString(),
    groupId: transaction.spaceId,
    initiatedByUserId: transaction.userId ?? undefined,
    description: transaction.description ?? undefined,
    destination: transaction.destination ?? undefined,
  };
};

const requireTransactionInGroup = async (
  groupId: string,
  transactionId: string,
): Promise<Transaction> => {
  const transaction = await getTransaction(groupId, transactionId);

  if (!transaction) {
    throw createHttpError(404, 'Transaction not found');
  }

  return transaction;
};

router.get('/', async (req: Request<ApprovalParams>, res, next) => {
  try {
    const { groupId, transactionId } = req.params;
    const user = await getCurrentUser(req.header('x-user-id'));
    await getGroupById(groupId);
    await requireMembership(groupId, user.id);
    const transaction = await requireTransactionById(transactionId);

    if (transaction.groupId !== groupId) {
      throw createHttpError(400, 'groupId does not match the transaction group');
    }

    const response: ApiResponse<ListApprovalsResponseDto> = {
      data: {
        approvals: await listApprovals(transactionId),
      },
    };

    res.json(response);
  } catch (error) {
    next(error);
  }
});

router.post('/', async (req: Request<ApprovalParams>, res, next) => {
  try {
    const { groupId, transactionId } = req.params;
    const user = await getCurrentUser(req.header('x-user-id'));
    const group = await getGroupById(groupId);
    await requireMembership(groupId, user.id);
    const transaction = await requireTransactionById(transactionId);

    if (transaction.groupId !== group.id) {
      throw createHttpError(400, 'groupId does not match the transaction group');
    }

    if (transaction.type !== TransactionType.WITHDRAWAL) {
      throw createHttpError(400, 'Only withdrawals can be approved');
    }

    const body = getObjectBody(req.body);
    const dto: CreateApprovalRequestDto = {
      status: ensureEnumValue(
        body.status,
        [ApprovalStatus.APPROVED, ApprovalStatus.REJECTED],
        'status must be approved or rejected',
      ),
    };

    if (dto.status === ApprovalStatus.APPROVED) {
      await approveWithdrawal(transaction.id, user.id);
    } else {
      await rejectWithdrawal(transaction.id, user.id);
    }
    const approval = await getApprovalByTransactionAndAdmin(transaction.id, user.id);

    if (!approval) {
      throw createHttpError(500, 'Approval could not be recorded');
    }

    const updatedTransaction = await requireTransactionInGroup(groupId, transactionId);

    const response: ApiResponse<CreateApprovalResponseDto> = {
      data: {
        approval,
        transaction: updatedTransaction,
      },
    };

    res.status(201).json(response);
  } catch (error) {
    next(error);
  }
});

export default router;
