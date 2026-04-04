import {
  CreateGroupRequestDto,
  Group,
  GroupMember,
  GroupRole,
  GroupSignatory,
  SignatoryRole,
  SpaceMember as SpaceMemberDto,
  Transaction,
  TransactionSource,
  TransactionsSummaryDto,
  TransactionStatus,
  TransactionType,
  UpdateGroupRequestDto,
} from '../../../shared/contracts';
import type { Prisma } from '@prisma/client';
import { approvals, groupMembers, groups, messages, transactions } from '../data/store';
import { createHttpError, createId } from '../utils/http';
import { prisma } from '../lib/prisma';
import { getUsersByIds } from '../utils/auth';

const MAX_SIGNATORIES = 3;
const JOINABLE_SIGNATORY_ROLES: Exclude<SignatoryRole, null>[] = [
  'primary',
  'secondary',
  'tertiary',
];
const PROMOTABLE_SIGNATORY_ROLES: Exclude<SignatoryRole, null>[] = ['secondary', 'tertiary'];

type Withdrawal = {
  id: string;
  spaceId: string;
  requestedByUserId: string;
  amount: number;
  reason?: string;
  status: 'pending' | 'approved' | 'completed' | 'failed';
  approvals: string[];
  requiredApprovals: number;
  createdAt: string;
};

const withdrawals: Withdrawal[] = [];

const getMpesaPaybillNumber = (): string => {
  return process.env.MPESA_PAYBILL?.trim() || '522522';
};

const isUniqueConstraintError = (error: unknown): boolean => {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'P2002'
  );
};

const mapDbSpaceToGroup = (space: {
  accountNumber: string | null;
  createdAt: Date;
  createdById: string;
  deadline: Date | null;
  description: string | null;
  id: string;
  imageUrl: string | null;
  name: string;
  paybillNumber: string | null;
  targetAmount: number | null;
}): Group => {
  return {
    id: space.id,
    name: space.name,
    description: space.description ?? undefined,
    imageUrl: space.imageUrl ?? undefined,
    paybillNumber: space.paybillNumber ?? getMpesaPaybillNumber(),
    accountNumber: space.accountNumber ?? '',
    targetAmount: space.targetAmount ?? undefined,
    collectedAmount: 0,
    deadline: space.deadline?.toISOString(),
    createdByUserId: space.createdById,
    approvalThreshold: 1,
    createdAt: space.createdAt.toISOString(),
  };
};

const mapDbSpaceMemberToGroupMember = (member: {
  createdAt: Date;
  id: string;
  role: string;
  spaceId: string;
  userId: string;
}): GroupMember => {
  const isAdmin = member.role === 'admin';

  return {
    id: member.id,
    groupId: member.spaceId,
    userId: member.userId,
    role: isAdmin ? GroupRole.SIGNATORY : GroupRole.MEMBER,
    signatoryRole: isAdmin ? 'primary' : null,
    joinedAt: member.createdAt.toISOString(),
  };
};

const mapDbSpaceMemberToSpaceMember = (member: {
  createdAt: Date;
  id: string;
  role: string;
  spaceId: string;
  user: {
    name: string | null;
  } | null;
  userId: string;
}): SpaceMemberDto => {
  return {
    ...mapDbSpaceMemberToGroupMember(member),
    name: member.user?.name ?? member.userId,
  };
};

const mapDbTransactionToContractTransaction = (transaction: {
  amount: Prisma.Decimal | number;
  createdAt: Date;
  externalName: string | null;
  id: string;
  phoneNumber: string | null;
  reference: string;
  source: TransactionSource | string;
  spaceId: string;
  status: TransactionStatus | string;
  type: TransactionType | string;
  userId: string | null;
}): Transaction => {
  const amount =
    typeof transaction.amount === 'number'
      ? transaction.amount
      : Number(transaction.amount);

  return {
    id: transaction.id,
    spaceId: transaction.spaceId,
    userId: transaction.userId ?? undefined,
    groupId: transaction.spaceId,
    initiatedByUserId: transaction.userId ?? `external_${transaction.id}`,
    type: transaction.type as TransactionType,
    amount,
    reference: transaction.reference,
    source: transaction.source as TransactionSource,
    phoneNumber: transaction.phoneNumber ?? undefined,
    externalName: transaction.externalName ?? undefined,
    status: transaction.status as TransactionStatus,
    createdAt: transaction.createdAt.toISOString(),
    currency: 'KES',
  };
};

export const getCompletedBalancesBySpaceIds = async (
  spaceIds: string[],
): Promise<Map<string, number>> => {
  const uniqueSpaceIds = Array.from(new Set(spaceIds.filter(Boolean)));

  if (uniqueSpaceIds.length === 0) {
    return new Map<string, number>();
  }

  const groupedTransactions = await prisma.transaction.groupBy({
    by: ['spaceId', 'type'],
    where: {
      spaceId: {
        in: uniqueSpaceIds,
      },
      status: TransactionStatus.COMPLETED,
    },
    _sum: {
      amount: true,
    },
  });

  return groupedTransactions.reduce<Map<string, number>>((balanceMap, item) => {
    const currentBalance = balanceMap.get(item.spaceId) ?? 0;
    const amount = Number(item._sum.amount ?? 0);
    const nextBalance =
      item.type === TransactionType.WITHDRAWAL
        ? currentBalance - amount
        : currentBalance + amount;

    balanceMap.set(item.spaceId, nextBalance);
    return balanceMap;
  }, new Map<string, number>());
};

export const getCompletedBalanceForSpace = async (spaceId: string): Promise<number> => {
  const balancesBySpaceId = await getCompletedBalancesBySpaceIds([spaceId]);
  return balancesBySpaceId.get(spaceId) ?? 0;
};

export const storeWebhookPayload = async (payload: Record<string, unknown>): Promise<string> => {
  const referenceValue =
    payload.reference ??
    payload.receiptCode ??
    payload.TransID ??
    payload.MpesaReceiptNumber;
  const reference =
    typeof referenceValue === 'string' && referenceValue.trim().length > 0
      ? referenceValue.trim()
      : null;

  const event = await prisma.webhookEvent.create({
    data: {
      provider: 'mpesa',
      eventType: 'payment_confirmation',
      reference,
      status: 'received',
      payload: payload as Prisma.InputJsonValue,
    },
  });

  return event.id;
};

export const finalizeWebhookLog = async (
  logId: string,
  result: string,
  metadata?: {
    errorMessage?: string;
    reference?: string | null;
    spaceId?: string | null;
    status?: string;
  },
): Promise<void> => {
  await prisma.webhookEvent.update({
    where: {
      id: logId,
    },
    data: {
      processedAt: new Date(),
      status: metadata?.status ?? result,
      reference: metadata?.reference ?? undefined,
      spaceId: metadata?.spaceId ?? undefined,
      errorMessage: metadata?.errorMessage ?? undefined,
    },
  });
};

const normalizePhoneNumber = (value: string): string => {
  const digitsOnly = value.replace(/[^\d]/g, '');

  if (digitsOnly.startsWith('254')) {
    return digitsOnly;
  }

  if (digitsOnly.startsWith('0')) {
    return `254${digitsOnly.slice(1)}`;
  }

  return digitsOnly;
};

const generateAccountNumber = (): string => {
  let accountNumber = '';

  do {
    accountNumber = `AKB_${Date.now().toString(36).toUpperCase()}_${Math.random()
      .toString(36)
      .slice(2, 6)
      .toUpperCase()}`;
  } while (groups.some((group) => group.accountNumber === accountNumber));

  return accountNumber;
};

const getGroupOrThrow = (groupId: string): Group => {
  const group = groups.find((item) => item.id === groupId);

  if (!group) {
    throw createHttpError(404, 'Group not found');
  }

  return group;
};

const getMemberOrThrow = (groupId: string, memberId: string): GroupMember => {
  const member = groupMembers.find((item) => item.groupId === groupId && item.id === memberId);

  if (!member) {
    throw createHttpError(404, 'Group member not found');
  }

  return member;
};

const getMemberByUserId = (groupId: string, userId: string): GroupMember | undefined => {
  return groupMembers.find((item) => item.groupId === groupId && item.userId === userId);
};

const requireRequesterMembership = (groupId: string, userId: string): GroupMember => {
  const membership = getMemberByUserId(groupId, userId);

  if (!membership) {
    throw createHttpError(403, 'You are not a member of this group');
  }

  return membership;
};

const requireCreatorAccess = (group: Group, userId: string): void => {
  if (group.createdByUserId !== userId) {
    throw createHttpError(403, 'Only the account creator can manage signatories');
  }
};

const getSignatoriesForGroup = (groupId: string): GroupMember[] => {
  return groupMembers.filter((item) => item.groupId === groupId && item.signatoryRole !== null);
};

const getAssignedRoles = (groupId: string): Exclude<SignatoryRole, null>[] => {
  return getSignatoriesForGroup(groupId)
    .map((item) => item.signatoryRole)
    .filter((role): role is Exclude<SignatoryRole, null> => role !== null);
};

const countSignatories = (groupId: string): number => {
  return getSignatoriesForGroup(groupId).length;
};

const getNextAvailableRole = (
  groupId: string,
  candidates: Exclude<SignatoryRole, null>[],
): Exclude<SignatoryRole, null> | null => {
  const assignedRoles = getAssignedRoles(groupId);

  for (const role of candidates) {
    if (!assignedRoles.includes(role)) {
      return role;
    }
  }

  return null;
};

const clampApprovalThreshold = (group: Group): void => {
  const signatoryCount = countSignatories(group.id);

  if (group.approvalThreshold > signatoryCount) {
    group.approvalThreshold = signatoryCount;
  }
};

const removeById = <T extends { id: string }>(items: T[], id: string): void => {
  const index = items.findIndex((item) => item.id === id);

  if (index >= 0) {
    items.splice(index, 1);
  }
};

const hasPendingApprovalRisk = (groupId: string, userId: string): boolean => {
  return transactions.some((transaction) => {
    if (transaction.groupId !== groupId || transaction.status !== TransactionStatus.PENDING_APPROVAL) {
      return false;
    }

    if (transaction.initiatedByUserId === userId) {
      return true;
    }

    return approvals.some(
      (approval) => approval.transactionId === transaction.id && approval.signatoryUserId === userId,
    );
  });
};

const isAdminForGroup = (groupId: string, userId: string): boolean => {
  const membership = getMemberByUserId(groupId, userId);

  if (!membership) {
    return false;
  }

  return membership.role === GroupRole.SIGNATORY || membership.signatoryRole !== null;
};

const aggregateByDate = (
  entries: Array<{ amount: number; createdAt: string }>,
): Array<{ date: string; amount: number }> => {
  const totalsByDate: Record<string, number> = {};

  entries.forEach((entry) => {
    const date = new Date(entry.createdAt).toISOString().split('T')[0];
    totalsByDate[date] = (totalsByDate[date] || 0) + entry.amount;
  });

  return Object.keys(totalsByDate)
    .sort()
    .map((date) => ({
      date,
      amount: totalsByDate[date],
    }));
};

export const createGroup = (
  userId: string,
  dto: CreateGroupRequestDto,
): { group: Group; member: GroupMember } => {
  if (dto.approvalThreshold > MAX_SIGNATORIES) {
    throw createHttpError(400, 'approvalThreshold cannot exceed the maximum signatories (3)');
  }

  const group: Group = {
    id: createId('group'),
    name: dto.name,
    description: dto.description,
    imageUrl: dto.image,
    paybillNumber: getMpesaPaybillNumber(),
    accountNumber: generateAccountNumber(),
    targetAmount: dto.targetAmount,
    collectedAmount: dto.targetAmount ? 0 : undefined,
    deadline: dto.deadline,
    createdByUserId: userId,
    approvalThreshold: dto.approvalThreshold,
    createdAt: new Date().toISOString(),
  };

  const member: GroupMember = {
    id: createId('member'),
    groupId: group.id,
    userId,
    role: GroupRole.SIGNATORY,
    signatoryRole: 'primary',
    joinedAt: new Date().toISOString(),
  };

  groups.push(group);
  groupMembers.push(member);

  return { group, member };
};

export const createSpace = async (input: {
  name: string;
  description?: string;
  imageUrl?: string;
  targetAmount?: number;
  deadline?: string;
  createdById: string;
}): Promise<{ space: Group }> => {
  const accountNumber = `AKB_${Date.now()}`;

  try {
    const space = await prisma.$transaction(async (tx) => {
      const createdSpace = await tx.space.create({
        data: {
          name: input.name,
          description: input.description,
          imageUrl: input.imageUrl,
          targetAmount: input.targetAmount,
          deadline: input.deadline ? new Date(input.deadline) : undefined,
          paybillNumber: getMpesaPaybillNumber(),
          accountNumber,
          createdById: input.createdById,
        },
      });

      await tx.spaceMember.create({
        data: {
          spaceId: createdSpace.id,
          userId: input.createdById,
          role: 'admin',
        },
      });

      return createdSpace;
    });

    return {
      space: {
        id: space.id,
        name: space.name,
        description: space.description ?? undefined,
        imageUrl: space.imageUrl ?? undefined,
        paybillNumber: space.paybillNumber ?? getMpesaPaybillNumber(),
        accountNumber: space.accountNumber ?? accountNumber,
        targetAmount: space.targetAmount ?? undefined,
        collectedAmount: 0,
        deadline: space.deadline ? space.deadline.toISOString() : undefined,
        createdByUserId: space.createdById,
        approvalThreshold: 1,
        createdAt: space.createdAt.toISOString(),
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    throw createHttpError(500, `Failed to create space: ${message}`);
  }
};

export const joinSpace = async (spaceId: string, userId: string): Promise<GroupMember> => {
  const space = await prisma.space.findUnique({
    where: {
      id: spaceId,
    },
  });

  if (!space) {
    throw createHttpError(404, 'Group not found');
  }

  const existingMembership = await prisma.spaceMember.findFirst({
    where: {
      spaceId,
      userId,
    },
  });

  if (existingMembership) {
    throw createHttpError(409, 'User is already a member of this group');
  }

  let membership;

  try {
    membership = await prisma.spaceMember.create({
      data: {
        spaceId,
        userId,
        role: 'member',
      },
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw createHttpError(409, 'User is already a member of this group');
    }

    throw error;
  }

  return mapDbSpaceMemberToGroupMember(membership);
};

export const leaveSpace = async (spaceId: string, userId: string): Promise<GroupMember> => {
  const membership = await prisma.spaceMember.findFirst({
    where: {
      spaceId,
      userId,
    },
    include: {
      space: true,
    },
  });

  if (!membership) {
    throw createHttpError(404, 'Group member not found');
  }

  if (!membership.space) {
    throw createHttpError(404, 'Group not found');
  }

  if (membership.space.createdById === userId) {
    throw createHttpError(409, 'Creator cannot leave group');
  }

  if (membership.role === 'admin') {
    const adminCount = await prisma.spaceMember.count({
      where: {
        spaceId,
        role: 'admin',
      },
    });

    if (adminCount <= 1) {
      throw createHttpError(409, 'At least one admin must remain in the group');
    }

    throw createHttpError(409, 'Admins must be demoted before leaving the space');
  }

  await prisma.spaceMember.delete({
    where: {
      id: membership.id,
    },
  });

  return mapDbSpaceMemberToGroupMember(membership);
};

export const getSpaceMembers = async (spaceId: string): Promise<SpaceMemberDto[]> => {
  const space = await prisma.space.findUnique({
    where: {
      id: spaceId,
    },
  });

  if (!space) {
    throw createHttpError(404, 'Group not found');
  }

  const members = await prisma.spaceMember.findMany({
    where: {
      spaceId,
    },
    include: {
      user: true,
    },
    orderBy: [
      {
        role: 'asc',
      },
      {
        createdAt: 'asc',
      },
    ],
  });

  return members.map(mapDbSpaceMemberToSpaceMember);
};

export const updateGroup = (
  groupId: string,
  actorUserId: string,
  dto: UpdateGroupRequestDto,
): Group => {
  const group = getGroupOrThrow(groupId);
  requireRequesterMembership(groupId, actorUserId);
  requireCreatorAccess(group, actorUserId);

  if (dto.name !== undefined) {
    group.name = dto.name;
  }

  if (Object.prototype.hasOwnProperty.call(dto, 'description')) {
    group.description = dto.description;
  }

  if (dto.imageUrl !== undefined) {
    group.imageUrl = dto.imageUrl;
  }

  if (dto.approvalThreshold !== undefined) {
    if (dto.approvalThreshold > MAX_SIGNATORIES) {
      throw createHttpError(400, 'approvalThreshold cannot exceed the maximum signatories (3)');
    }

    group.approvalThreshold = dto.approvalThreshold;
    clampApprovalThreshold(group);
  }

  if (dto.targetAmount !== undefined) {
    group.targetAmount = dto.targetAmount;
    group.collectedAmount = dto.targetAmount > 0 ? group.collectedAmount ?? 0 : undefined;
  }

  if (Object.prototype.hasOwnProperty.call(dto, 'deadline')) {
    group.deadline = dto.deadline;
  }

  return group;
};

export const joinGroup = (groupId: string, userId: string): GroupMember => {
  const nextSignatoryRole = getNextAvailableRole(groupId, JOINABLE_SIGNATORY_ROLES);
  const member: GroupMember = {
    id: createId('member'),
    groupId,
    userId,
    role: nextSignatoryRole === null ? GroupRole.MEMBER : GroupRole.SIGNATORY,
    signatoryRole: nextSignatoryRole,
    joinedAt: new Date().toISOString(),
  };

  groupMembers.push(member);

  return member;
};

export const getSignatoryReport = async (
  groupId: string,
  requesterUserId: string,
): Promise<{ signatories: GroupSignatory[]; remainingSlots: number }> => {
  getGroupOrThrow(groupId);
  requireRequesterMembership(groupId, requesterUserId);

  const signatoryMembers = getSignatoriesForGroup(groupId);
  const usersById = await getUsersByIds(signatoryMembers.map((member) => member.userId));
  const signatories = signatoryMembers
    .map((member) => {
      const user = usersById.get(member.userId);

      if (!user || member.signatoryRole === null) {
        return null;
      }

      return {
        userId: member.userId,
        name: user.name,
        signatoryRole: member.signatoryRole,
      };
    })
    .filter((item): item is GroupSignatory => item !== null);

  return {
    signatories,
    remainingSlots: MAX_SIGNATORIES - signatories.length,
  };
};

export const processMpesaWebhookPayment = async (
  input: {
    accountNumber: string;
    amount: number;
    externalName?: string;
    phoneNumber: string;
    reference: string;
    source?: TransactionSource;
  },
): Promise<{ deposit: Transaction; duplicate: boolean; group: Group }> => {
  const {
    accountNumber,
    amount,
    externalName,
    phoneNumber,
    reference,
    source = TransactionSource.MPESA_PAYBILL,
  } = input;
  const space = await prisma.space.findUnique({
    where: {
      accountNumber,
    },
  });

  if (!space) {
    throw createHttpError(404, 'Space not found for this account number');
  }

  const normalizedPhoneNumber = normalizePhoneNumber(phoneNumber);
  const existingTransaction = await prisma.transaction.findUnique({
    where: {
      reference,
    },
  });

  if (existingTransaction) {
    return {
      deposit: mapDbTransactionToContractTransaction(existingTransaction),
      duplicate: true,
      group: mapDbSpaceToGroup(space),
    };
  }

  try {
    const createdTransaction = await prisma.transaction.create({
      data: {
        spaceId: space.id,
        userId: null,
        type: TransactionType.DEPOSIT,
        status: TransactionStatus.COMPLETED,
        amount,
        reference,
        source,
        phoneNumber: normalizedPhoneNumber,
        externalName,
      },
    });

    return {
      deposit: mapDbTransactionToContractTransaction(createdTransaction),
      duplicate: false,
      group: mapDbSpaceToGroup(space),
    };
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      const duplicateTransaction = await prisma.transaction.findUnique({
        where: {
          reference,
        },
      });

      if (!duplicateTransaction) {
        throw error;
      }

      return {
        deposit: mapDbTransactionToContractTransaction(duplicateTransaction),
        duplicate: true,
        group: mapDbSpaceToGroup(space),
      };
    }

    throw error;
  }
};

export const createDeposit = async (
  spaceId: string,
  userId: string | null,
  amount: number,
  options?: {
    externalName?: string;
    phoneNumber?: string;
    reference?: string;
    source?: TransactionSource;
  },
): Promise<Transaction> => {
  if (amount <= 0) {
    throw createHttpError(400, 'amount must be a positive number');
  }

  const space = await prisma.space.findUnique({
    where: {
      id: spaceId,
    },
  });

  if (!space) {
    throw createHttpError(404, 'Group not found');
  }

  const reference = options?.reference?.trim() || createId('deposit_ref');
  const transactionStatus = userId ? TransactionStatus.INITIATED : TransactionStatus.PENDING;

  try {
    const transaction = await prisma.transaction.create({
      data: {
        spaceId,
        userId,
        type: TransactionType.DEPOSIT,
        status: transactionStatus,
        amount,
        reference,
        source: options?.source ?? TransactionSource.MPESA_STK,
        phoneNumber: options?.phoneNumber,
        externalName: options?.externalName,
      },
    });

    return mapDbTransactionToContractTransaction(transaction);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw createHttpError(409, 'A deposit with this reference already exists');
    }

    throw error;
  }
};

export const createWithdrawal = async (
  spaceId: string,
  userId: string,
  amount: number,
  reason?: string,
): Promise<Withdrawal> => {
  if (amount <= 0) {
    throw createHttpError(400, 'amount must be a positive number');
  }

  const group = getGroupOrThrow(spaceId);
  const currentBalance = group.collectedAmount ?? 0;

  if (currentBalance < amount) {
    throw createHttpError(409, 'Insufficient funds in this space');
  }

  const withdrawal: Withdrawal = {
    id: `wd_${Date.now()}`,
    spaceId,
    requestedByUserId: userId,
    amount,
    reason,
    status: 'pending',
    approvals: [],
    requiredApprovals: group.approvalThreshold ?? 1,
    createdAt: new Date().toISOString(),
  };

  withdrawals.push(withdrawal);

  return withdrawal;
};

export const approveWithdrawal = async (
  withdrawalId: string,
  userId: string,
): Promise<Withdrawal> => {
  const withdrawal = withdrawals.find((item) => item.id === withdrawalId);

  if (!withdrawal) {
    throw createHttpError(404, 'Withdrawal not found');
  }

  if (withdrawal.status !== 'pending') {
    throw createHttpError(409, 'Withdrawal is no longer pending');
  }

  if (!isAdminForGroup(withdrawal.spaceId, userId)) {
    throw createHttpError(403, 'Only admins can approve withdrawals');
  }

  if (withdrawal.approvals.includes(userId)) {
    throw createHttpError(409, 'You have already approved this withdrawal');
  }

  withdrawal.approvals.push(userId);

  if (withdrawal.approvals.length >= withdrawal.requiredApprovals) {
    withdrawal.status = 'approved';

    setTimeout(() => {
      if (withdrawal.status !== 'approved') {
        return;
      }

      const group = getGroupOrThrow(withdrawal.spaceId);
      const currentBalance = group.collectedAmount ?? 0;

      if (currentBalance < withdrawal.amount) {
        withdrawal.status = 'failed';
        return;
      }

      group.collectedAmount = currentBalance - withdrawal.amount;
      withdrawal.status = 'completed';
    }, 2500);
  }

  return withdrawal;
};

export const getTransactionsSummary = async (
  spaceId: string,
): Promise<TransactionsSummaryDto> => {
  const space = await prisma.space.findUnique({
    where: {
      id: spaceId,
    },
  });

  if (!space) {
    throw createHttpError(404, 'Group not found');
  }

  const [completedTransactions, pendingDepositTransactions] = await Promise.all([
    prisma.transaction.findMany({
      where: {
        spaceId,
        status: TransactionStatus.COMPLETED,
      },
      orderBy: {
        createdAt: 'asc',
      },
    }),
    prisma.transaction.findMany({
      where: {
        spaceId,
        type: TransactionType.DEPOSIT,
        status: {
          in: [TransactionStatus.INITIATED, TransactionStatus.PENDING],
        },
      },
      include: {
        user: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    }),
  ]);

  const completedDeposits = completedTransactions.filter(
    (transaction) => transaction.type === TransactionType.DEPOSIT,
  );
  const completedWithdrawals = completedTransactions.filter(
    (transaction) => transaction.type === TransactionType.WITHDRAWAL,
  );
  const pendingWithdrawals = withdrawals
    .filter(
      (withdrawal) =>
        withdrawal.spaceId === spaceId &&
        (withdrawal.status === 'pending' || withdrawal.status === 'approved'),
    );
  const pendingUserIds = [
    ...pendingWithdrawals.map((withdrawal) => withdrawal.requestedByUserId),
  ];
  const usersById = await getUsersByIds(pendingUserIds);
  const pendingDepositsSummary = pendingDepositTransactions.map((deposit) => {
    const userName =
      deposit.user?.name ??
      deposit.externalName ??
      deposit.phoneNumber ??
      'External payer';
    const derivedUserId = deposit.userId ?? `external_${deposit.id}`;

    return {
      id: deposit.id,
      userId: derivedUserId,
      userName,
      amount: Number(deposit.amount),
      status: 'pending' as const,
      createdAt: deposit.createdAt.toISOString(),
    };
  });
  const pendingWithdrawalsSummary = pendingWithdrawals.map((withdrawal) => {
    const user = usersById.get(withdrawal.requestedByUserId);

    return {
      id: withdrawal.id,
      requestedByUserId: withdrawal.requestedByUserId,
      requestedByName: user?.name ?? withdrawal.requestedByUserId,
      amount: withdrawal.amount,
      reason: withdrawal.reason,
      approvals: withdrawal.approvals,
      requiredApprovals: withdrawal.requiredApprovals,
      status: withdrawal.status,
      createdAt: withdrawal.createdAt,
    };
  });
  const totalDeposits = completedDeposits.reduce(
    (sum, deposit) => sum + Number(deposit.amount),
    0,
  );
  const totalWithdrawals = completedWithdrawals.reduce(
    (sum, withdrawal) => sum + Number(withdrawal.amount),
    0,
  );
  const depositsOverTime = aggregateByDate(
    completedDeposits.map((deposit) => ({
      amount: Number(deposit.amount),
      createdAt: deposit.createdAt.toISOString(),
    })),
  );
  const withdrawalsOverTime = aggregateByDate(
    completedWithdrawals.map((withdrawal) => ({
      amount: Number(withdrawal.amount),
      createdAt: withdrawal.createdAt.toISOString(),
    })),
  );

  return {
    totalDeposits,
    totalWithdrawals,
    currentBalance: totalDeposits - totalWithdrawals,
    depositsOverTime,
    withdrawalsOverTime,
    pendingWithdrawals: pendingWithdrawalsSummary,
    pendingDeposits: pendingDepositsSummary,
    hasPendingTransactions:
      pendingDepositsSummary.length > 0 || pendingWithdrawalsSummary.length > 0,
  } as TransactionsSummaryDto;
};

export const promoteMember = (
  groupId: string,
  memberId: string,
  actorUserId: string,
): GroupMember => {
  const group = getGroupOrThrow(groupId);
  requireRequesterMembership(groupId, actorUserId);
  requireCreatorAccess(group, actorUserId);

  const member = getMemberOrThrow(groupId, memberId);

  if (member.signatoryRole !== null || member.role === GroupRole.SIGNATORY) {
    throw createHttpError(409, 'Member is already a signatory');
  }

  if (countSignatories(groupId) >= MAX_SIGNATORIES) {
    throw createHttpError(409, 'This group already has the maximum number of signatories');
  }

  const nextRole = getNextAvailableRole(groupId, PROMOTABLE_SIGNATORY_ROLES);

  if (nextRole === null) {
    throw createHttpError(409, 'No signatory slot is available for promotion');
  }

  member.role = GroupRole.SIGNATORY;
  member.signatoryRole = nextRole;

  return member;
};

export const revokeMember = (
  groupId: string,
  memberId: string,
  actorUserId: string,
): GroupMember => {
  const group = getGroupOrThrow(groupId);
  requireRequesterMembership(groupId, actorUserId);
  requireCreatorAccess(group, actorUserId);

  const member = getMemberOrThrow(groupId, memberId);

  if (member.userId === group.createdByUserId || member.signatoryRole === 'primary') {
    throw createHttpError(409, 'The account creator cannot be revoked as a signatory');
  }

  if (member.signatoryRole === null || member.role !== GroupRole.SIGNATORY) {
    throw createHttpError(409, 'Only signatories can be revoked');
  }

  member.role = GroupRole.MEMBER;
  member.signatoryRole = null;

  clampApprovalThreshold(group);

  return member;
};

export const leaveGroup = (
  groupId: string,
  memberId: string,
  requesterUserId: string,
): GroupMember => {
  const group = getGroupOrThrow(groupId);
  const member = getMemberOrThrow(groupId, memberId);

  if (member.userId !== requesterUserId) {
    throw createHttpError(403, 'Users can only leave a group for themselves');
  }

  if (member.userId === group.createdByUserId || member.signatoryRole === 'primary') {
    throw createHttpError(409, 'Creator cannot leave group');
  }

  if (member.signatoryRole === 'secondary' || member.signatoryRole === 'tertiary') {
    throw createHttpError(409, 'Signatory must transfer role before leaving');
  }

  if (hasPendingApprovalRisk(groupId, requesterUserId)) {
    throw createHttpError(409, 'Cannot leave group with pending approvals on transactions');
  }

  removeById(groupMembers, member.id);

  return member;
};

export const deleteGroup = (groupId: string, requesterUserId: string): string => {
  const group = getGroupOrThrow(groupId);

  if (group.createdByUserId !== requesterUserId) {
    throw createHttpError(403, 'Only the creator can delete this group');
  }

  const groupTransactions = transactions.filter((item) => item.groupId === groupId);

  if (groupTransactions.some((item) => item.status === TransactionStatus.PENDING_APPROVAL)) {
    throw createHttpError(409, 'Cannot delete group with pending transactions');
  }

  if (groupTransactions.some((item) => item.status !== TransactionStatus.COMPLETED)) {
    throw createHttpError(409, 'Cannot delete group with active funds in system');
  }

  const groupTransactionIds = new Set(groupTransactions.map((item) => item.id));

  for (let index = approvals.length - 1; index >= 0; index -= 1) {
    if (groupTransactionIds.has(approvals[index].transactionId)) {
      approvals.splice(index, 1);
    }
  }

  for (let index = transactions.length - 1; index >= 0; index -= 1) {
    if (transactions[index].groupId === groupId) {
      transactions.splice(index, 1);
    }
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].groupId === groupId) {
      messages.splice(index, 1);
    }
  }

  for (let index = groupMembers.length - 1; index >= 0; index -= 1) {
    if (groupMembers[index].groupId === groupId) {
      groupMembers.splice(index, 1);
    }
  }

  removeById(groups, group.id);

  return group.id;
};
