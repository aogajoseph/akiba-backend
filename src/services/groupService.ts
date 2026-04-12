import {
  CreateGroupRequestDto,
  GetSpaceSummaryResponseDto,
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
import { normalizePhoneNumber } from '../../../shared/phone';
import { NotificationType, type Prisma } from '@prisma/client';
import { approvals, groupMembers, groups, messages, transactions } from '../data/store';
import { createHttpError, createId } from '../utils/http';
import { prisma } from '../lib/prisma';
import { getUsersByIds } from '../utils/auth';
import { emitNotification } from './notificationService';

const MAX_SIGNATORIES = 3;
const SYSTEM_APPROVAL_THRESHOLD = 2;
const MIN_ADMINS_REQUIRED_FOR_WITHDRAWALS = 3;
const JOINABLE_SIGNATORY_ROLES: Exclude<SignatoryRole, null>[] = [
  'primary',
  'secondary',
  'tertiary',
];
const PROMOTABLE_SIGNATORY_ROLES: Exclude<SignatoryRole, null>[] = ['secondary', 'tertiary'];
const SERVICE_FEE_RATE = 0.025;

const getMpesaPaybillNumber = (): string => {
  return process.env.MPESA_PAYBILL?.trim() || '522522';
};

const ensureApprovalThresholdInRange = (approvalThreshold: number): void => {
  if (approvalThreshold < 2 || approvalThreshold > 3) {
    throw createHttpError(400, 'approvalThreshold must be between 2 and 3');
  }
};

const isUniqueConstraintError = (error: unknown): boolean => {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'P2002'
  );
};

const normalizeHostedImageUrl = (value: string | undefined): string | undefined => {
  const normalizedValue = value?.trim();

  if (!normalizedValue) {
    return undefined;
  }

  if (!/^https?:\/\//i.test(normalizedValue)) {
    throw createHttpError(400, 'imageUrl must be an http or https URL');
  }

  return normalizedValue;
};

type SpaceUpdateNotificationField =
  | 'name'
  | 'image'
  | 'description'
  | 'targetAmount'
  | 'deadline';

type SpaceNotificationSnapshot = {
  deadline: Date | null;
  description: string | null;
  imageUrl: string | null;
  name: string;
  targetAmount: number | null;
};

const formatKesAmount = (amount: number): string => {
  return amount.toLocaleString('en-KE', {
    maximumFractionDigits: Number.isInteger(amount) ? 0 : 2,
  });
};

const formatReadableDate = (value: Date): string => {
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(value);
};

const resolveActorName = async (userId: string): Promise<string> => {
  const usersById = await getUsersByIds([userId]);
  return usersById.get(userId)?.name?.trim() || 'Someone';
};

const buildSpaceUpdateNotification = ({
  actorName,
  previousSpace,
  updatedSpace,
  changedFields,
}: {
  actorName: string;
  previousSpace: SpaceNotificationSnapshot;
  updatedSpace: SpaceNotificationSnapshot;
  changedFields: SpaceUpdateNotificationField[];
}): { body: string; title: string } => {
  if (changedFields.length !== 1) {
    return {
      title: 'Space updated',
      body: `"${actorName}" updated space details`,
    };
  }

  const [field] = changedFields;

  switch (field) {
    case 'name':
      return {
        title: 'Space name updated',
        body: `"${actorName}" renamed the space to "${updatedSpace.name}"`,
      };
    case 'image':
      return {
        title: 'Space image updated',
        body: `"${actorName}" updated the space image`,
      };
    case 'description':
      return {
        title: 'Description updated',
        body: `"${actorName}" updated the space description`,
      };
    case 'targetAmount':
      return {
        title: 'Target amount updated',
        body: `"${actorName}" set target to KES ${formatKesAmount(updatedSpace.targetAmount ?? 0)}`,
      };
    case 'deadline':
      if (updatedSpace.deadline) {
        return {
          title: 'Deadline updated',
          body: `"${actorName}" set deadline to ${formatReadableDate(updatedSpace.deadline)}`,
        };
      }

      if (previousSpace.deadline) {
        return {
          title: 'Deadline updated',
          body: `"${actorName}" removed the deadline`,
        };
      }

      return {
        title: 'Deadline updated',
        body: `"${actorName}" updated the space deadline`,
      };
    default:
      return {
        title: 'Space updated',
        body: `"${actorName}" updated space details`,
      };
  }
};

const mapDbSpaceToGroup = (space: {
  accountNumber: string | null;
  approvalThreshold: number;
  createdAt: Date;
  createdById: string;
  deadline: Date | null;
  description: string | null;
  id: string;
  imageUrl: string | null;
  name: string;
  paybillNumber: string | null;
  targetAmount: number | null;
}, collectedAmount = 0): Group => {
  return {
    id: space.id,
    name: space.name,
    description: space.description ?? undefined,
    imageUrl: space.imageUrl ?? undefined,
    paybillNumber: space.paybillNumber ?? getMpesaPaybillNumber(),
    accountNumber: space.accountNumber ?? '',
    targetAmount: space.targetAmount ?? undefined,
    collectedAmount,
    deadline: space.deadline?.toISOString(),
    createdByUserId: space.createdById,
    approvalThreshold: SYSTEM_APPROVAL_THRESHOLD,
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
  description?: string | null;
  destination?: string | null;
  externalName: string | null;
  id: string;
  phoneNumber: string | null;
  recipientName?: string | null;
  recipientPhoneNumber?: string | null;
  reference: string;
  source: TransactionSource | string;
  spaceId: string;
  status: TransactionStatus | string;
  type: TransactionType | string;
  user?: {
    name: string | null;
  } | null;
  userId: string | null;
  initiatorName?: string;
  runningBalance?: number;
}): Transaction => {
  const amount =
    typeof transaction.amount === 'number'
      ? transaction.amount
      : Number(transaction.amount);
  const initiatorName =
    transaction.initiatorName?.trim() ||
    transaction.user?.name?.trim() ||
    transaction.externalName?.trim() ||
    transaction.phoneNumber ||
    'External';

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
    initiatorName,
    runningBalance: transaction.runningBalance,
    recipientPhoneNumber: transaction.recipientPhoneNumber ?? undefined,
    recipientName: transaction.recipientName ?? undefined,
    status: transaction.status as TransactionStatus,
    createdAt: transaction.createdAt.toISOString(),
    currency: 'KES',
    description: transaction.description ?? undefined,
    reason: transaction.description ?? undefined,
    destination: transaction.destination ?? undefined,
  };
};

const mapDbWithdrawalApprovalToContractApproval = (approval: {
  adminId: string;
  createdAt: Date;
  id: string;
  status: string;
  transactionId: string;
}) => {
  return {
    id: approval.id,
    transactionId: approval.transactionId,
    signatoryUserId: approval.adminId,
    status: approval.status as 'approved' | 'rejected',
    createdAt: approval.createdAt.toISOString(),
  };
};

const roundCurrency = (value: number): number => {
  return Math.round((value + Number.EPSILON) * 100) / 100;
};

const calculateServiceFee = (amount: number): number => {
  return Number((amount * SERVICE_FEE_RATE).toFixed(2));
};

const calculateWithdrawalFee = (amount: number): number => {
  return roundCurrency(amount * SERVICE_FEE_RATE);
};

const getSpaceApprovalThreshold = (space: { approvalThreshold: number | null }): number => {
  void space;
  return SYSTEM_APPROVAL_THRESHOLD;
};

const requireSpaceCreator = (space: { createdById: string }, userId: string): void => {
  if (space.createdById !== userId) {
    throw createHttpError(403, 'Only the account creator can manage signatories');
  }
};

const getSpaceOrThrow = async (spaceId: string) => {
  const space = await prisma.space.findUnique({
    where: {
      id: spaceId,
    },
  });

  if (!space) {
    throw createHttpError(404, 'Group not found');
  }

  return space;
};

const getSpaceMembershipOrThrow = async (spaceId: string, userId: string) => {
  const membership = await prisma.spaceMember.findFirst({
    where: {
      spaceId,
      userId,
    },
  });

  if (!membership) {
    throw createHttpError(403, 'You are not a member of this group');
  }

  return membership;
};

const requireSpaceAdmin = async (spaceId: string, userId: string) => {
  const membership = await prisma.spaceMember.findFirst({
    where: {
      spaceId,
      userId,
    },
  });

  if (!membership) {
    throw createHttpError(403, 'You are not a member of this group');
  }

  if (membership.role !== 'admin') {
    throw createHttpError(403, 'Only admins can approve or reject withdrawals');
  }

  return membership;
};

export const getAvailableBalanceForSpace = async (spaceId: string): Promise<number> => {
  const snapshots = await getSpaceFinancialSnapshotBySpaceIds([spaceId]);
  return snapshots.get(spaceId)?.availableBalance ?? 0;
};

export const getCompletedBalancesBySpaceIds = async (
  spaceIds: string[],
): Promise<Map<string, number>> => {
  const snapshots = await getSpaceFinancialSnapshotBySpaceIds(spaceIds);
  return new Map(
    Array.from(snapshots.entries()).map(([spaceId, snapshot]) => [
      spaceId,
      snapshot.availableBalance,
    ]),
  );
};

export const getSpaceFinancialSnapshotBySpaceIds = async (
  spaceIds: string[],
): Promise<
  Map<
    string,
    {
      availableBalance: number;
      pendingWithdrawalAmount: number;
      reservedAmount: number;
      totalBalance: number;
      totalFees: number;
    }
  >
> => {
  const uniqueSpaceIds = Array.from(new Set(spaceIds.filter(Boolean)));

  if (uniqueSpaceIds.length === 0) {
    return new Map();
  }

  const [completedDeposits, pendingWithdrawals, completedWithdrawals] = await Promise.all([
    prisma.transaction.groupBy({
      by: ['spaceId'],
      where: {
        spaceId: {
          in: uniqueSpaceIds,
        },
        type: TransactionType.DEPOSIT,
        status: TransactionStatus.COMPLETED,
      },
      _sum: {
        amount: true,
      },
    }),
    prisma.transaction.groupBy({
      by: ['spaceId'],
      where: {
        spaceId: {
          in: uniqueSpaceIds,
        },
        type: TransactionType.WITHDRAWAL,
        status: {
          in: [TransactionStatus.PENDING_APPROVAL, TransactionStatus.APPROVED],
        },
      },
      _sum: {
        amount: true,
      },
    }),
    prisma.transaction.groupBy({
      by: ['spaceId'],
      where: {
        spaceId: {
          in: uniqueSpaceIds,
        },
        type: TransactionType.WITHDRAWAL,
        status: TransactionStatus.COMPLETED,
      },
      _sum: {
        amount: true,
      },
    }),
  ]);

  const depositsBySpaceId = new Map(
    completedDeposits.map((item) => [item.spaceId, Number(item._sum.amount ?? 0)]),
  );
  const pendingWithdrawalsBySpaceId = new Map(
    pendingWithdrawals.map((item) => [item.spaceId, Number(item._sum.amount ?? 0)]),
  );
  const completedWithdrawalsBySpaceId = new Map(
    completedWithdrawals.map((item) => [item.spaceId, Number(item._sum.amount ?? 0)]),
  );

  return uniqueSpaceIds.reduce((snapshotMap, spaceId) => {
    const totalBalance = depositsBySpaceId.get(spaceId) ?? 0;
    const pendingWithdrawalAmount = pendingWithdrawalsBySpaceId.get(spaceId) ?? 0;
    const completedWithdrawalAmount = completedWithdrawalsBySpaceId.get(spaceId) ?? 0;
    const effectiveDeposits = roundCurrency(
      totalBalance - completedWithdrawalAmount - pendingWithdrawalAmount,
    );
    const totalFees = calculateServiceFee(effectiveDeposits);
    const reservedAmount = roundCurrency(
      pendingWithdrawalAmount + completedWithdrawalAmount,
    );
    const availableBalance = roundCurrency(
      effectiveDeposits - totalFees,
    );

    snapshotMap.set(spaceId, {
      totalBalance,
      totalFees,
      pendingWithdrawalAmount,
      reservedAmount,
      availableBalance,
    });

    return snapshotMap;
  }, new Map<string, {
    availableBalance: number;
    pendingWithdrawalAmount: number;
    reservedAmount: number;
    totalBalance: number;
    totalFees: number;
  }>());
};

const buildCreatedAtFilter = (filters?: {
  from?: Date;
  to?: Date;
}): Prisma.DateTimeFilter | undefined => {
  if (!filters?.from && !filters?.to) {
    return undefined;
  }

  return {
    gte: filters?.from,
    lte: filters?.to,
  };
};

export const getSpaceSummary = async (
  spaceId: string,
  filters?: {
    from?: Date;
    to?: Date;
  },
): Promise<GetSpaceSummaryResponseDto> => {
  await getSpaceOrThrow(spaceId);

  const createdAt = buildCreatedAtFilter(filters);
  const openingBalanceWhere: Prisma.TransactionWhereInput = {
    spaceId,
    type: {
      in: [TransactionType.DEPOSIT, TransactionType.WITHDRAWAL],
    },
    status: TransactionStatus.COMPLETED,
    ...(filters?.from
      ? {
          createdAt: {
            lt: filters.from,
          },
        }
      : {}),
  };
  const where: Prisma.TransactionWhereInput = {
    spaceId,
    createdAt,
  };

  const [
    openingTransactions,
    completedDeposits,
    completedWithdrawals,
    pendingWithdrawals,
    transactions,
  ] = await Promise.all([
    filters?.from
      ? prisma.transaction.findMany({
          where: openingBalanceWhere,
          orderBy: [
            {
              createdAt: 'asc',
            },
            {
              id: 'asc',
            },
          ],
        })
      : Promise.resolve([]),
    prisma.transaction.aggregate({
      where: {
        ...where,
        type: TransactionType.DEPOSIT,
        status: TransactionStatus.COMPLETED,
      },
      _sum: {
        amount: true,
      },
    }),
    prisma.transaction.aggregate({
      where: {
        ...where,
        type: TransactionType.WITHDRAWAL,
        status: TransactionStatus.COMPLETED,
      },
      _sum: {
        amount: true,
      },
    }),
    prisma.transaction.aggregate({
      where: {
        ...where,
        type: TransactionType.WITHDRAWAL,
        status: {
          in: [TransactionStatus.PENDING_APPROVAL, TransactionStatus.APPROVED],
        },
      },
      _sum: {
        amount: true,
      },
    }),
    prisma.transaction.findMany({
      where,
      include: {
        user: true,
      },
      orderBy: [
        {
          createdAt: 'asc',
        },
        {
          id: 'asc',
        },
      ],
    }),
  ]);

  const totalDeposits = Number(completedDeposits._sum.amount ?? 0);
  const totalWithdrawals = Number(completedWithdrawals._sum.amount ?? 0);
  const pendingWithdrawalAmount = Number(pendingWithdrawals._sum.amount ?? 0);
  const effectiveDeposits = roundCurrency(
    totalDeposits - totalWithdrawals - pendingWithdrawalAmount,
  );
  const totalFees = calculateServiceFee(effectiveDeposits);
  let runningBalance = openingTransactions.reduce((sum, transaction) => {
    if (transaction.type === TransactionType.DEPOSIT) {
      return sum + Number(transaction.amount);
    }

    if (transaction.type === TransactionType.WITHDRAWAL) {
      return sum - Number(transaction.amount);
    }

    return sum;
  }, 0);

  const enrichedTransactions = transactions.map((transaction) => {
    const amount = Number(transaction.amount);

    if (
      transaction.type === TransactionType.DEPOSIT &&
      transaction.status === TransactionStatus.COMPLETED
    ) {
      runningBalance += amount;
    }

    if (
      transaction.type === TransactionType.WITHDRAWAL &&
      transaction.status !== TransactionStatus.FAILED &&
      transaction.status !== TransactionStatus.REJECTED
    ) {
      runningBalance -= amount;
    }

    const initiatorName =
      transaction.user?.name?.trim() ||
      transaction.externalName?.trim() ||
      (transaction.phoneNumber ? transaction.phoneNumber : 'External');

    return mapDbTransactionToContractTransaction({
      ...transaction,
      initiatorName,
      runningBalance,
    });
  });

  return {
    summary: {
      totalDeposits,
      totalWithdrawals,
      totalFees,
      availableBalance: roundCurrency(effectiveDeposits - totalFees),
      netBalance: roundCurrency(effectiveDeposits - totalFees),
    },
    transactions: enrichedTransactions,
  };
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

const normalizeStoredPhoneNumber = (value: string, fieldName: string): string => {
  try {
    return normalizePhoneNumber(value);
  } catch {
    throw createHttpError(400, `${fieldName} must be a valid Kenyan phone number`);
  }
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
  const imageUrl = normalizeHostedImageUrl(dto.imageUrl ?? dto.image);
  const group: Group = {
    id: createId('group'),
    name: dto.name,
    description: dto.description,
    imageUrl,
    paybillNumber: getMpesaPaybillNumber(),
    accountNumber: generateAccountNumber(),
    targetAmount: dto.targetAmount,
    collectedAmount: dto.targetAmount ? 0 : undefined,
    deadline: dto.deadline,
    createdByUserId: userId,
    approvalThreshold: SYSTEM_APPROVAL_THRESHOLD,
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
  const imageUrl = normalizeHostedImageUrl(input.imageUrl);

  try {
    const space = await prisma.$transaction(async (tx) => {
      const createdSpace = await tx.space.create({
        data: {
          name: input.name,
          description: input.description,
          imageUrl,
          targetAmount: input.targetAmount,
          deadline: input.deadline ? new Date(input.deadline) : undefined,
          paybillNumber: getMpesaPaybillNumber(),
          accountNumber,
          approvalThreshold: SYSTEM_APPROVAL_THRESHOLD,
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
        approvalThreshold: SYSTEM_APPROVAL_THRESHOLD,
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

export const updateGroup = async (
  groupId: string,
  actorUserId: string,
  dto: UpdateGroupRequestDto,
): Promise<Group> => {
  const space = await getSpaceOrThrow(groupId);
  await getSpaceMembershipOrThrow(groupId, actorUserId);
  requireSpaceCreator(space, actorUserId);
  const normalizedImageUrl = normalizeHostedImageUrl(dto.imageUrl);
  const changedFields: SpaceUpdateNotificationField[] = [];
  const currentDeadline = space.deadline?.toISOString() ?? null;
  const nextDeadline = Object.prototype.hasOwnProperty.call(dto, 'deadline')
    ? dto.deadline
      ? new Date(dto.deadline).toISOString()
      : null
    : currentDeadline;

  if (dto.name !== undefined && dto.name !== space.name) {
    changedFields.push('name');
  }

  if (
    Object.prototype.hasOwnProperty.call(dto, 'description') &&
    (dto.description ?? null) !== (space.description ?? null)
  ) {
    changedFields.push('description');
  }

  if (
    Object.prototype.hasOwnProperty.call(dto, 'imageUrl') &&
    (normalizedImageUrl ?? null) !== (space.imageUrl ?? null)
  ) {
    changedFields.push('image');
  }

  if (
    dto.targetAmount !== undefined &&
    dto.targetAmount !== (space.targetAmount ?? undefined)
  ) {
    changedFields.push('targetAmount');
  }

  if (
    Object.prototype.hasOwnProperty.call(dto, 'deadline') &&
    nextDeadline !== currentDeadline
  ) {
    changedFields.push('deadline');
  }

  const updatedSpace = await prisma.space.update({
    where: {
      id: groupId,
    },
    data: {
      name: dto.name,
      description: Object.prototype.hasOwnProperty.call(dto, 'description')
        ? dto.description ?? null
        : undefined,
      imageUrl: normalizedImageUrl,
      targetAmount: dto.targetAmount,
      deadline: Object.prototype.hasOwnProperty.call(dto, 'deadline')
        ? dto.deadline
          ? new Date(dto.deadline)
          : null
        : undefined,
    },
  });
  if (changedFields.length > 0) {
    const actorName = await resolveActorName(actorUserId);
    const notificationMessage = buildSpaceUpdateNotification({
      actorName,
      previousSpace: {
        name: space.name,
        imageUrl: space.imageUrl,
        description: space.description,
        targetAmount: space.targetAmount,
        deadline: space.deadline,
      },
      updatedSpace: {
        name: updatedSpace.name,
        imageUrl: updatedSpace.imageUrl,
        description: updatedSpace.description,
        targetAmount: updatedSpace.targetAmount,
        deadline: updatedSpace.deadline,
      },
      changedFields,
    });

    await emitNotification({
      type: NotificationType.space_updated,
      spaceId: updatedSpace.id,
      actorId: actorUserId,
      eventKey: `space:${updatedSpace.id}:updated:${Date.now()}`,
      title: notificationMessage.title,
      body: notificationMessage.body,
      metadata: {
        updatedFields: changedFields,
      },
      excludeActorFromRecipients: true,
    });
  }

  const balance = await getCompletedBalanceForSpace(groupId);

  return mapDbSpaceToGroup(updatedSpace, balance);
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
  const normalizedPhoneNumber = normalizeStoredPhoneNumber(phoneNumber, 'phoneNumber');
  const ALLOWED_COMPLETION_STATUSES: string[] = [
    TransactionStatus.INITIATED,
    TransactionStatus.PENDING,
  ];
  const existingTransaction = await prisma.transaction.findUnique({
    where: {
      reference,
    },
    include: {
      space: true,
    },
  });

  if (existingTransaction) {
    if (existingTransaction.type !== TransactionType.DEPOSIT) {
      throw createHttpError(409, 'Reference already belongs to a different transaction type');
    }

    if (Number(existingTransaction.amount) !== amount) {
      throw createHttpError(409, 'Webhook amount does not match the existing deposit');
    }

    if (existingTransaction.status === TransactionStatus.COMPLETED) {
      return {
        deposit: mapDbTransactionToContractTransaction(existingTransaction),
        duplicate: true,
        group: mapDbSpaceToGroup(existingTransaction.space),
      };
    }

    if (!ALLOWED_COMPLETION_STATUSES.includes(existingTransaction.status)) {
      throw createHttpError(
        409,
        `Cannot complete deposit from status ${existingTransaction.status}`,
      );
    }

    const completedTransaction = await prisma.transaction.update({
      where: {
        id: existingTransaction.id,
      },
      data: {
        status: TransactionStatus.COMPLETED,
        phoneNumber: normalizedPhoneNumber,
        externalName: externalName?.trim() || undefined,
      },
      include: {
        space: true,
      },
    });

    await emitNotification({
      type: NotificationType.deposit_completed,
      spaceId: completedTransaction.spaceId,
      transactionId: completedTransaction.id,
      actorId: null,
      eventKey: `deposit:${completedTransaction.id}:completed`,
      title: 'Deposit received',
      body: `KES ${amount} deposited successfully`,
      metadata: {
        amount,
        currency: 'KES',
      },
    });

    return {
      deposit: mapDbTransactionToContractTransaction(completedTransaction),
      duplicate: false,
      group: mapDbSpaceToGroup(completedTransaction.space),
    };
  }

  const space = await prisma.space.findUnique({
    where: {
      accountNumber,
    },
  });

  if (!space) {
    throw createHttpError(404, 'Space not found for this account number');
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
        externalName: externalName?.trim() || undefined,
      },
    });

    await emitNotification({
      type: NotificationType.deposit_completed,
      spaceId: createdTransaction.spaceId,
      transactionId: createdTransaction.id,
      actorId: null,
      eventKey: `deposit:${createdTransaction.id}:completed`,
      title: 'Deposit received',
      body: `KES ${amount} deposited successfully`,
      metadata: {
        amount,
        currency: 'KES',
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
  input: {
    amount: number;
    phoneNumber?: string;
    reference?: string;
    source: TransactionSource;
    spaceId: string;
    userId: string | null;
    externalName?: string;
  },
): Promise<Transaction> => {
  if (input.amount <= 0) {
    throw createHttpError(400, 'amount must be a positive number');
  }

  if (input.source !== TransactionSource.MPESA) {
    throw createHttpError(400, 'Payment method not yet supported');
  }

  if (!input.phoneNumber) {
    throw createHttpError(400, 'phoneNumber must be a valid Kenyan phone number');
  }

  const space = await prisma.space.findUnique({
    where: {
      id: input.spaceId,
    },
  });

  if (!space) {
    throw createHttpError(404, 'Group not found');
  }

  const reference = input.reference?.trim() || createId('deposit_ref');
  const transactionStatus = input.userId
    ? TransactionStatus.INITIATED
    : TransactionStatus.PENDING;
  const normalizedPhoneNumber = normalizeStoredPhoneNumber(
    input.phoneNumber,
    'phoneNumber',
  );

  try {
    const transaction = await prisma.transaction.create({
      data: {
        spaceId: input.spaceId,
        userId: input.userId,
        type: TransactionType.DEPOSIT,
        status: transactionStatus,
        amount: input.amount,
        reference,
        source: input.source,
        phoneNumber: normalizedPhoneNumber,
        externalName: input.externalName,
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
  details: {
    reason: string;
    recipientPhoneNumber: string;
    recipientName: string;
  },
): Promise<Transaction> => {
  if (amount <= 0) {
    throw createHttpError(400, 'amount must be a positive number');
  }

  if (!details.reason.trim()) {
    throw createHttpError(400, 'reason must be a non-empty string');
  }

  if (!details.recipientPhoneNumber.trim()) {
    throw createHttpError(400, 'recipientPhoneNumber must be a non-empty string');
  }

  const normalizedRecipientPhoneNumber = normalizeStoredPhoneNumber(
    details.recipientPhoneNumber,
    'recipientPhoneNumber',
  );

  if (!details.recipientName.trim()) {
    throw createHttpError(400, 'recipientName must be a non-empty string');
  }

  const space = await getSpaceOrThrow(spaceId);
  await getSpaceMembershipOrThrow(spaceId, userId);
  if (userId !== space.createdById) {
    throw createHttpError(403, 'Only the space creator can initiate withdrawals');
  }

  const adminCount = await prisma.spaceMember.count({
    where: {
      spaceId,
      role: 'admin',
    },
  });

  if (adminCount < MIN_ADMINS_REQUIRED_FOR_WITHDRAWALS) {
    throw createHttpError(
      409,
      'To request withdrawals, promote at least 2 members to Admin.',
    );
  }

  const activeWithdrawal = await prisma.transaction.findFirst({
    where: {
      spaceId,
      type: TransactionType.WITHDRAWAL,
      status: {
        in: [TransactionStatus.PENDING_APPROVAL, TransactionStatus.APPROVED],
      },
    },
  });

  if (activeWithdrawal) {
    throw createHttpError(
      409,
      'Please wait for the current withdrawal to complete before starting a new one.',
    );
  }

  const availableBalance = await getAvailableBalanceForSpace(spaceId);

  if (amount > availableBalance) {
    throw createHttpError(409, 'Insufficient funds in this space');
  }

  const withdrawal = await prisma.transaction.create({
    data: {
      spaceId,
      userId,
      type: TransactionType.WITHDRAWAL,
      status: TransactionStatus.PENDING_APPROVAL,
      amount,
      reference: createId('withdrawal_ref'),
      source: TransactionSource.BANK_TRANSFER,
      description: details.reason.trim(),
      recipientPhoneNumber: normalizedRecipientPhoneNumber,
      recipientName: details.recipientName.trim(),
    },
  });

  await emitNotification({
    type: NotificationType.withdrawal_requested,
    spaceId: withdrawal.spaceId,
    transactionId: withdrawal.id,
    actorId: userId,
    eventKey: `withdrawal:${withdrawal.id}:requested`,
    title: 'Withdrawal requested',
    body: `KES ${Number(amount)} withdrawal request submitted`,
    metadata: {
      amount: Number(amount),
      currency: 'KES',
    },
  });

  return mapDbTransactionToContractTransaction(withdrawal);
};

export const approveWithdrawal = async (
  withdrawalId: string,
  userId: string,
): Promise<Transaction> => {
  const withdrawal = await prisma.transaction.findUnique({
    where: {
      id: withdrawalId,
    },
    include: {
      space: true,
      approvals: true,
    },
  });

  if (!withdrawal) {
    throw createHttpError(404, 'Withdrawal not found');
  }

  if (withdrawal.type !== TransactionType.WITHDRAWAL) {
    throw createHttpError(400, 'Only withdrawals can be approved');
  }

  if (withdrawal.status !== TransactionStatus.PENDING_APPROVAL) {
    throw createHttpError(409, 'Withdrawal is no longer pending approval');
  }

  await requireSpaceAdmin(withdrawal.spaceId, userId);
  if (withdrawal.userId === userId) {
    throw createHttpError(403, 'Creator cannot approve their own withdrawal');
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const approval = await tx.withdrawalApproval.create({
        data: {
          transactionId: withdrawal.id,
          adminId: userId,
          status: 'approved',
        },
      });

      const approvedCount = await tx.withdrawalApproval.count({
        where: {
          transactionId: withdrawal.id,
          status: 'approved',
        },
      });

      const nextStatus =
        approvedCount >= getSpaceApprovalThreshold(withdrawal.space)
          ? TransactionStatus.APPROVED
          : TransactionStatus.PENDING_APPROVAL;

      const updatedWithdrawal = await tx.transaction.update({
        where: {
          id: withdrawal.id,
        },
        data: {
          status: nextStatus,
        },
      });

      return {
        approvalCount: approvedCount,
        approvalThreshold: getSpaceApprovalThreshold(withdrawal.space),
        approval,
        updatedWithdrawal,
      };
    });
    const isFinalApproval = result.updatedWithdrawal.status === TransactionStatus.APPROVED;

    await emitNotification({
      type: NotificationType.withdrawal_approved,
      spaceId: result.updatedWithdrawal.spaceId,
      transactionId: result.updatedWithdrawal.id,
      actorId: userId,
      eventKey: `withdrawal:${result.updatedWithdrawal.id}:approved:${result.approval.id}`,
      title: isFinalApproval
        ? 'Withdrawal fully approved'
        : 'Withdrawal approved',
      body: isFinalApproval
        ? `KES ${Number(result.updatedWithdrawal.amount)} fully approved and ready for execution`
        : `KES ${Number(result.updatedWithdrawal.amount)} approval recorded`,
      metadata: {
        amount: Number(result.updatedWithdrawal.amount),
        currency: 'KES',
        approvalCount: result.approvalCount,
        approvalThreshold: result.approvalThreshold,
        isFinalApproval,
      },
    });

    return mapDbTransactionToContractTransaction(result.updatedWithdrawal);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw createHttpError(409, 'You have already approved or rejected this withdrawal');
    }

    throw error;
  }
};

export const rejectWithdrawal = async (
  transactionId: string,
  userId: string,
): Promise<Transaction> => {
  const withdrawal = await prisma.transaction.findUnique({
    where: {
      id: transactionId,
    },
  });

  if (!withdrawal) {
    throw createHttpError(404, 'Withdrawal not found');
  }

  if (withdrawal.type !== TransactionType.WITHDRAWAL) {
    throw createHttpError(400, 'Only withdrawals can be rejected');
  }

  if (withdrawal.status !== TransactionStatus.PENDING_APPROVAL) {
    throw createHttpError(409, 'Only pending withdrawals can be rejected');
  }

  await requireSpaceAdmin(withdrawal.spaceId, userId);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const approval = await tx.withdrawalApproval.create({
        data: {
          transactionId,
          adminId: userId,
          status: 'rejected',
        },
      });

      const rejectedWithdrawal = await tx.transaction.update({
        where: {
          id: transactionId,
        },
        data: {
          status: TransactionStatus.REJECTED,
        },
      });

      return {
        approval,
        rejectedWithdrawal,
      };
    });

    await emitNotification({
      type: NotificationType.withdrawal_rejected,
      spaceId: result.rejectedWithdrawal.spaceId,
      transactionId: result.rejectedWithdrawal.id,
      actorId: userId,
      eventKey: `withdrawal:${result.rejectedWithdrawal.id}:rejected:${result.approval.id}`,
      title: 'Withdrawal rejected',
      body: `KES ${Number(result.rejectedWithdrawal.amount)} rejected`,
      metadata: {
        amount: Number(result.rejectedWithdrawal.amount),
        currency: 'KES',
      },
    });

    return mapDbTransactionToContractTransaction(result.rejectedWithdrawal);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw createHttpError(409, 'You have already approved or rejected this withdrawal');
    }

    throw error;
  }
};

export const executeWithdrawal = async (
  transactionId: string,
  executorUserId?: string,
): Promise<{ withdrawal: Transaction; fee: Transaction | null }> => {
  const result = await prisma.$transaction(async (tx) => {
    const withdrawal = await tx.transaction.findUnique({
      where: {
        id: transactionId,
      },
    });

    if (!withdrawal) {
      throw createHttpError(404, 'Withdrawal not found');
    }

    if (withdrawal.type !== TransactionType.WITHDRAWAL) {
      throw createHttpError(400, 'Only withdrawals can be executed');
    }

    if (executorUserId) {
      const executorMembership = await tx.spaceMember.findFirst({
        where: {
          spaceId: withdrawal.spaceId,
          userId: executorUserId,
        },
      });

      if (!executorMembership || executorMembership.role !== 'admin') {
        throw createHttpError(403, 'Only admins can execute withdrawals');
      }
    }

    const existingFee = await tx.transaction.findUnique({
      where: {
        reference: `${withdrawal.reference}_fee`,
      },
    });

    if (withdrawal.status === TransactionStatus.COMPLETED) {
      return {
        didComplete: false,
        fee: existingFee,
        withdrawal,
      };
    }

    if (withdrawal.status !== TransactionStatus.APPROVED) {
      throw createHttpError(409, 'Withdrawal must be approved before execution');
    }

    const feeAmount = calculateWithdrawalFee(Number(withdrawal.amount));
    const [completedDeposits, reservedWithdrawals, completedFees] = await Promise.all([
      tx.transaction.aggregate({
        where: {
          spaceId: withdrawal.spaceId,
          type: TransactionType.DEPOSIT,
          status: TransactionStatus.COMPLETED,
        },
        _sum: {
          amount: true,
        },
      }),
      tx.transaction.aggregate({
        where: {
          spaceId: withdrawal.spaceId,
          type: TransactionType.WITHDRAWAL,
          status: {
            in: [TransactionStatus.APPROVED, TransactionStatus.COMPLETED],
          },
        },
        _sum: {
          amount: true,
        },
      }),
      tx.transaction.aggregate({
        where: {
          spaceId: withdrawal.spaceId,
          type: TransactionType.FEE,
          status: TransactionStatus.COMPLETED,
        },
        _sum: {
          amount: true,
        },
      }),
    ]);

    const availableAfterReservation = roundCurrency(
      Number(completedDeposits._sum.amount ?? 0) -
        Number(reservedWithdrawals._sum.amount ?? 0) -
        Number(completedFees._sum.amount ?? 0),
    );

    if (!existingFee && feeAmount > availableAfterReservation) {
      throw createHttpError(409, 'Insufficient funds to cover withdrawal fees');
    }

    let feeTransaction = existingFee;

    if (feeAmount > 0 && !feeTransaction) {
      try {
        feeTransaction = await tx.transaction.create({
          data: {
            spaceId: withdrawal.spaceId,
            userId: withdrawal.userId,
            type: TransactionType.FEE,
            status: TransactionStatus.COMPLETED,
            amount: feeAmount,
            reference: `${withdrawal.reference}_fee`,
            source: TransactionSource.SYSTEM_FEE,
            description: 'Withdrawal processing fee',
          },
        });
      } catch (error) {
        if (!isUniqueConstraintError(error)) {
          throw error;
        }

        feeTransaction = await tx.transaction.findUnique({
          where: {
            reference: `${withdrawal.reference}_fee`,
          },
        });
      }
    }

    const completedWithdrawal = await tx.transaction.update({
      where: {
        id: transactionId,
      },
      data: {
        status: TransactionStatus.COMPLETED,
      },
    });

    return {
      didComplete: true,
      fee: feeTransaction,
      withdrawal: completedWithdrawal,
    };
  });

  if (result.didComplete) {
    await emitNotification({
      type: NotificationType.withdrawal_completed,
      spaceId: result.withdrawal.spaceId,
      transactionId: result.withdrawal.id,
      actorId: null,
      eventKey: `withdrawal:${result.withdrawal.id}:completed`,
      title: 'Withdrawal completed',
      body: `KES ${Number(result.withdrawal.amount)} sent successfully`,
      metadata: {
        amount: Number(result.withdrawal.amount),
        currency: 'KES',
      },
    });
  }

  return {
    withdrawal: mapDbTransactionToContractTransaction(result.withdrawal),
    fee: result.fee ? mapDbTransactionToContractTransaction(result.fee) : null,
  };
};

export const listWithdrawalApprovals = async (transactionId: string) => {
  const approvals = await prisma.withdrawalApproval.findMany({
    where: {
      transactionId,
    },
    orderBy: {
      createdAt: 'asc',
    },
  });

  return approvals.map(mapDbWithdrawalApprovalToContractApproval);
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

  const [completedTransactions, pendingDepositTransactions, activeWithdrawals] = await Promise.all([
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
    prisma.transaction.findMany({
      where: {
        spaceId,
        type: TransactionType.WITHDRAWAL,
        status: {
          in: [TransactionStatus.PENDING_APPROVAL, TransactionStatus.APPROVED],
        },
      },
      include: {
        approvals: {
          where: {
            status: 'approved',
          },
        },
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
  const completedFees = completedTransactions.filter(
    (transaction) => transaction.type === TransactionType.FEE,
  );
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
  const pendingWithdrawalsSummary = activeWithdrawals.map((withdrawal) => {
    const userName = withdrawal.user?.name ?? withdrawal.userId ?? 'Unknown member';
    const approvalIds = withdrawal.approvals.map((approval) => approval.adminId);

    return {
      id: withdrawal.id,
      requestedByUserId: withdrawal.userId ?? `external_${withdrawal.id}`,
      requestedByName: userName,
      amount: Number(withdrawal.amount),
      recipientName: withdrawal.recipientName ?? undefined,
      recipientPhoneNumber: withdrawal.recipientPhoneNumber ?? undefined,
      reason: withdrawal.description ?? undefined,
      approvals: approvalIds,
      requiredApprovals: getSpaceApprovalThreshold(space),
      status:
        withdrawal.status === TransactionStatus.APPROVED ? 'approved' : 'pending',
      createdAt: withdrawal.createdAt.toISOString(),
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
  const totalFees = completedFees.reduce(
    (sum, fee) => sum + Number(fee.amount),
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
    currentBalance: totalDeposits - totalWithdrawals - totalFees,
    depositsOverTime,
    withdrawalsOverTime,
    pendingWithdrawals: pendingWithdrawalsSummary,
    pendingDeposits: pendingDepositsSummary,
    hasPendingTransactions:
      pendingDepositsSummary.length > 0 || pendingWithdrawalsSummary.length > 0,
  } as TransactionsSummaryDto;
};

export const promoteMember = async (
  groupId: string,
  memberId: string,
  actorUserId: string,
): Promise<GroupMember> => {
  const space = await getSpaceOrThrow(groupId);
  await getSpaceMembershipOrThrow(groupId, actorUserId);
  requireSpaceCreator(space, actorUserId);

  const member = await prisma.spaceMember.findFirst({
    where: {
      id: memberId,
      spaceId: groupId,
    },
  });

  if (!member) {
    throw createHttpError(404, 'Group member not found');
  }

  if (member.role === 'admin') {
    throw createHttpError(409, 'Member is already a signatory');
  }

  const adminCount = await prisma.spaceMember.count({
    where: {
      spaceId: groupId,
      role: 'admin',
    },
  });

  if (adminCount >= 3) {
    throw createHttpError(409, 'This group already has the maximum number of signatories');
  }

  const updatedMember = await prisma.spaceMember.update({
    where: {
      id: member.id,
    },
    data: {
      role: 'admin',
    },
  });

  return mapDbSpaceMemberToGroupMember(updatedMember);
};

export const revokeMember = async (
  groupId: string,
  memberId: string,
  actorUserId: string,
): Promise<GroupMember> => {
  const space = await getSpaceOrThrow(groupId);
  await getSpaceMembershipOrThrow(groupId, actorUserId);
  requireSpaceCreator(space, actorUserId);

  const member = await prisma.spaceMember.findFirst({
    where: {
      id: memberId,
      spaceId: groupId,
    },
  });

  if (!member) {
    throw createHttpError(404, 'Group member not found');
  }

  if (member.userId === space.createdById) {
    throw createHttpError(409, 'The account creator cannot be revoked as a signatory');
  }

  if (member.role !== 'admin') {
    throw createHttpError(409, 'Only signatories can be revoked');
  }

  const adminCount = await prisma.spaceMember.count({
    where: {
      spaceId: groupId,
      role: 'admin',
    },
  });

  if (adminCount <= 2) {
    throw createHttpError(409, 'At least 2 admins must remain in the group');
  }

  const updatedMember = await prisma.spaceMember.update({
    where: {
      id: member.id,
    },
    data: {
      role: 'member',
    },
  });

  if (space.approvalThreshold > adminCount - 1) {
    await prisma.space.update({
      where: {
        id: groupId,
      },
      data: {
        approvalThreshold: adminCount - 1,
      },
    });
  }

  return mapDbSpaceMemberToGroupMember(updatedMember);
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

export const deleteGroup = async (
  groupId: string,
  requesterUserId: string,
): Promise<string> => {
  const deletionResult = await prisma.$transaction(async (tx) => {
    const [space, membership] = await Promise.all([
      tx.space.findUnique({
        where: {
          id: groupId,
        },
      }),
      tx.spaceMember.findFirst({
        where: {
          spaceId: groupId,
          userId: requesterUserId,
        },
      }),
    ]);

    if (!space) {
      throw createHttpError(404, 'Space not found');
    }

    if (!membership) {
      throw createHttpError(403, 'You are not a member of this space');
    }

    if (space.createdById !== requesterUserId) {
      throw createHttpError(403, 'Only the creator can delete this space');
    }

    const [
      activeWithdrawalCount,
      completedDeposits,
      pendingWithdrawals,
      completedWithdrawals,
      transactionRecords,
      notificationsForSpace,
      memberRecords,
    ] = await Promise.all([
      tx.transaction.count({
        where: {
          spaceId: groupId,
          type: TransactionType.WITHDRAWAL,
          status: {
            in: [TransactionStatus.PENDING_APPROVAL, TransactionStatus.APPROVED],
          },
        },
      }),
      tx.transaction.aggregate({
        where: {
          spaceId: groupId,
          type: TransactionType.DEPOSIT,
          status: TransactionStatus.COMPLETED,
        },
        _sum: {
          amount: true,
        },
      }),
      tx.transaction.aggregate({
        where: {
          spaceId: groupId,
          type: TransactionType.WITHDRAWAL,
          status: {
            in: [TransactionStatus.PENDING_APPROVAL, TransactionStatus.APPROVED],
          },
        },
        _sum: {
          amount: true,
        },
      }),
      tx.transaction.aggregate({
        where: {
          spaceId: groupId,
          type: TransactionType.WITHDRAWAL,
          status: TransactionStatus.COMPLETED,
        },
        _sum: {
          amount: true,
        },
      }),
      tx.transaction.findMany({
        where: {
          spaceId: groupId,
        },
        select: {
          id: true,
        },
      }),
      tx.notification.findMany({
        where: {
          spaceId: groupId,
        },
        select: {
          id: true,
        },
      }),
      tx.spaceMember.findMany({
        where: {
          spaceId: groupId,
        },
        select: {
          userId: true,
        },
      }),
    ]);

    if (activeWithdrawalCount > 0) {
      throw createHttpError(400, 'Cannot delete space with pending withdrawals');
    }

    const totalDeposits = Number(completedDeposits._sum.amount ?? 0);
    const reservedWithdrawals = Number(pendingWithdrawals._sum.amount ?? 0);
    const totalWithdrawals = Number(completedWithdrawals._sum.amount ?? 0);
    const effectiveDeposits = roundCurrency(
      totalDeposits - totalWithdrawals - reservedWithdrawals,
    );
    const totalFees = calculateServiceFee(effectiveDeposits);
    const availableBalance = roundCurrency(effectiveDeposits - totalFees);

    if (availableBalance !== 0) {
      throw createHttpError(400, 'Space balance must be zero before deletion');
    }

    const transactionIds = transactionRecords.map((transaction) => transaction.id);
    const notificationIds = notificationsForSpace.map((notification) => notification.id);

    if (notificationIds.length > 0) {
      await tx.notificationRecipient.deleteMany({
        where: {
          notificationId: {
            in: notificationIds,
          },
        },
      });
    }

    if (transactionIds.length > 0) {
      await tx.withdrawalApproval.deleteMany({
        where: {
          transactionId: {
            in: transactionIds,
          },
        },
      });
    }

    await tx.notification.deleteMany({
      where: {
        spaceId: groupId,
      },
    });
    await tx.transaction.deleteMany({
      where: {
        spaceId: groupId,
      },
    });
    await tx.spaceMember.deleteMany({
      where: {
        spaceId: groupId,
      },
    });
    await tx.webhookEvent.deleteMany({
      where: {
        spaceId: groupId,
      },
    });
    await tx.space.delete({
      where: {
        id: groupId,
      },
    });

    return {
      memberUserIds: memberRecords.map((member) => member.userId),
      spaceId: groupId,
    };
  });
  const actorName = await resolveActorName(requesterUserId);

  await emitNotification({
    type: NotificationType.space_deleted,
    spaceId: deletionResult.spaceId,
    actorId: requesterUserId,
    eventKey: `space:${deletionResult.spaceId}:deleted`,
    title: 'Space deleted',
    body: `"${actorName}" deleted the space`,
    metadata: {},
    recipientUserIds: deletionResult.memberUserIds,
    excludeActorFromRecipients: true,
  });

  return deletionResult.spaceId;
};
