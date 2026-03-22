import { Request, Router } from 'express';

import {
  ApiResponse,
  ApprovalStatus,
  CreateApprovalRequestDto,
  CreateApprovalResponseDto,
  Group,
  GroupMember,
  GroupRole,
  ListApprovalsResponseDto,
  Transaction,
  TransactionStatus,
  TransactionType,
  User,
} from '../../../shared/contracts';
import { approvals, groupMembers, groups, transactions, users } from '../data/store';
import {
  createHttpError,
  ensureEnumValue,
  ensureNonEmptyString,
  getObjectBody,
} from '../utils/http';
import { getTransaction } from '../services/transactionService';
import { createApproval, listApprovals } from '../services/approvalService';

const router = Router({ mergeParams: true });

type ApprovalParams = {
  groupId: string;
  transactionId: string;
};

const getCurrentUser = (headerValue: string | undefined): User => {
  const userId = ensureNonEmptyString(headerValue, 'x-user-id header is required');
  const user = users.find((item) => item.id === userId);

  if (!user) {
    throw createHttpError(404, 'User not found');
  }

  return user;
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

const requireTransactionById = (transactionId: string): Transaction => {
  const transaction = transactions.find((item) => item.id === transactionId);

  if (!transaction) {
    throw createHttpError(404, 'Transaction not found');
  }

  return transaction;
};

const requireTransactionInGroup = (groupId: string, transactionId: string): Transaction => {
  const transaction = getTransaction(groupId, transactionId);

  if (!transaction) {
    throw createHttpError(404, 'Transaction not found');
  }

  return transaction;
};

router.get('/', (req: Request<ApprovalParams>, res, next) => {
  try {
    const { groupId, transactionId } = req.params;
    const user = getCurrentUser(req.header('x-user-id'));
    getGroupById(groupId);
    requireMembership(groupId, user.id);
    const transaction = requireTransactionById(transactionId);

    if (transaction.groupId !== groupId) {
      throw createHttpError(400, 'groupId does not match the transaction group');
    }

    const response: ApiResponse<ListApprovalsResponseDto> = {
      data: {
        approvals: listApprovals(transactionId),
      },
    };

    res.json(response);
  } catch (error) {
    next(error);
  }
});

router.post('/', (req: Request<ApprovalParams>, res, next) => {
  try {
    const { groupId, transactionId } = req.params;
    const user = getCurrentUser(req.header('x-user-id'));
    const group = getGroupById(groupId);
    const membership = requireMembership(groupId, user.id);
    const transaction = requireTransactionById(transactionId);

    if (transaction.groupId !== group.id) {
      throw createHttpError(400, 'groupId does not match the transaction group');
    }

    if (transaction.type !== TransactionType.WITHDRAWAL) {
      throw createHttpError(400, 'Only withdrawals can be approved');
    }

    if (membership.role !== GroupRole.SIGNATORY) {
      throw createHttpError(403, 'Only signatories can approve or reject withdrawals');
    }

    if (transaction.status !== TransactionStatus.PENDING_APPROVAL) {
      throw createHttpError(409, 'Only pending withdrawals can be approved or rejected');
    }

    const existingApproval = approvals.find(
      (item) =>
        item.transactionId === transaction.id && item.signatoryUserId === user.id,
    );

    if (existingApproval) {
      throw createHttpError(409, 'You have already approved or rejected this withdrawal');
    }

    const body = getObjectBody(req.body);
    const dto: CreateApprovalRequestDto = {
      status: ensureEnumValue(
        body.status,
        [ApprovalStatus.APPROVED, ApprovalStatus.REJECTED],
        'status must be approved or rejected',
      ),
    };

    const approval = createApproval(transaction.id, user.id, dto);
    const updatedTransaction = requireTransactionInGroup(groupId, transactionId);

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
