import {
  CreateGroupRequestDto,
  Group,
  GroupMember,
  GroupRole,
  GroupSignatory,
  SignatoryRole,
  Transaction,
  TransactionsSummaryDto,
  TransactionStatus,
  TransactionType,
  UpdateGroupRequestDto,
} from '../../../shared/contracts';
import { approvals, groupMembers, groups, messages, transactions, users } from '../data/store';
import { createHttpError, createId } from '../utils/http';
import { prisma } from '../lib/prisma';

const MAX_SIGNATORIES = 3;
const JOINABLE_SIGNATORY_ROLES: Exclude<SignatoryRole, null>[] = [
  'primary',
  'secondary',
  'tertiary',
];
const PROMOTABLE_SIGNATORY_ROLES: Exclude<SignatoryRole, null>[] = ['secondary', 'tertiary'];

type Deposit = {
  id: string;
  spaceId: string;
  userId: string;
  amount: number;
  status: 'pending' | 'completed' | 'failed';
  createdAt: string;
};

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

const deposits: Deposit[] = [];
const withdrawals: Withdrawal[] = [];
const webhookLogs: Array<{
  id: string;
  payload: Record<string, unknown>;
  processedAt?: string;
  receivedAt: string;
  result?: string;
}> = [];

const getMpesaPaybillNumber = (): string => {
  return process.env.MPESA_PAYBILL?.trim() || '522522';
};

export const storeWebhookPayload = (payload: Record<string, unknown>): string => {
  const logId = createId('mpesa_webhook');

  webhookLogs.push({
    id: logId,
    payload,
    receivedAt: new Date().toISOString(),
  });

  return logId;
};

export const finalizeWebhookLog = (logId: string, result: string): void => {
  const logEntry = webhookLogs.find((entry) => entry.id === logId);

  if (!logEntry) {
    return;
  }

  logEntry.processedAt = new Date().toISOString();
  logEntry.result = result;
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
    const space = await prisma.space.create({
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

    await prisma.spaceMember.create({
      data: {
        spaceId: space.id,
        userId: input.createdById,
        role: 'admin',
      },
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

export const getSignatoryReport = (
  groupId: string,
  requesterUserId: string,
): { signatories: GroupSignatory[]; remainingSlots: number } => {
  getGroupOrThrow(groupId);
  requireRequesterMembership(groupId, requesterUserId);

  const signatories = getSignatoriesForGroup(groupId)
    .map((member) => {
      const user = users.find((item) => item.id === member.userId);

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
  amount: number,
  accountNumber: string,
  phoneNumber: string,
  receiptCode: string,
): Promise<{ deposit: Deposit | null; duplicate: boolean; group: Group }> => {
  const group = groups.find((item) => item.accountNumber === accountNumber);

  if (!group) {
    throw createHttpError(404, 'Space not found for this account number');
  }

  const existingTransaction = transactions.find(
    (transaction) => transaction.reference === receiptCode,
  );

  if (existingTransaction) {
    return { deposit: null, duplicate: true, group };
  }

  const normalizedPhoneNumber = normalizePhoneNumber(phoneNumber);
  const matchedUser = users.find(
    (user) => normalizePhoneNumber(user.phoneNumber) === normalizedPhoneNumber,
  );
  const deposit: Deposit = {
    id: `dep_${Date.now()}`,
    spaceId: group.id,
    userId: matchedUser?.id ?? `mpesa_${normalizedPhoneNumber}`,
    amount,
    status: 'completed',
    createdAt: new Date().toISOString(),
  };
  const transaction: Transaction = {
    id: createId('txn'),
    groupId: group.id,
    initiatedByUserId: deposit.userId,
    type: TransactionType.DEPOSIT,
    amount,
    currency: 'KES',
    description: `M-Pesa Paybill deposit via ${group.paybillNumber}`,
    source: 'mpesa_paybill',
    reference: receiptCode,
    phoneNumber: normalizedPhoneNumber,
    status: TransactionStatus.COMPLETED,
    createdAt: deposit.createdAt,
  };

  deposits.push(deposit);
  transactions.push(transaction);
  group.collectedAmount = (group.collectedAmount ?? 0) + amount;

  return { deposit, duplicate: false, group };
};

export const createDeposit = async (
  spaceId: string,
  userId: string,
  amount: number,
): Promise<Deposit> => {
  if (amount <= 0) {
    throw createHttpError(400, 'amount must be a positive number');
  }

  const group = getGroupOrThrow(spaceId);
  const deposit: Deposit = {
    id: `dep_${Date.now()}`,
    spaceId,
    userId,
    amount,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };

  deposits.push(deposit);

  setTimeout(() => {
    if (deposit.status !== 'pending') {
      return;
    }

    deposit.status = 'completed';
    group.collectedAmount = (group.collectedAmount ?? 0) + amount;
  }, 2500);

  return deposit;
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
  getGroupOrThrow(spaceId);
  const completedDeposits = deposits.filter(
    (deposit) => deposit.spaceId === spaceId && deposit.status === 'completed',
  );
  const pendingDeposits = deposits
    .filter((deposit) => deposit.spaceId === spaceId && deposit.status === 'pending')
    .map((deposit) => {
      const user = users.find((item) => item.id === deposit.userId);

      return {
        id: deposit.id,
        userId: deposit.userId,
        userName: user?.name ?? deposit.userId,
        amount: deposit.amount,
        status: deposit.status,
        createdAt: deposit.createdAt,
      };
    });
  const completedWithdrawals = withdrawals.filter(
    (withdrawal) => withdrawal.spaceId === spaceId && withdrawal.status === 'completed',
  );
  const pendingWithdrawals = withdrawals
    .filter(
      (withdrawal) =>
        withdrawal.spaceId === spaceId &&
        (withdrawal.status === 'pending' || withdrawal.status === 'approved'),
    )
    .map((withdrawal) => {
      const user = users.find((item) => item.id === withdrawal.requestedByUserId);

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
  const totalDeposits = completedDeposits.reduce((sum, deposit) => sum + deposit.amount, 0);
  const totalWithdrawals = completedWithdrawals.reduce(
    (sum, withdrawal) => sum + withdrawal.amount,
    0,
  );
  const depositsOverTime = aggregateByDate(completedDeposits);
  const withdrawalsOverTime = aggregateByDate(completedWithdrawals);

  return {
    totalDeposits,
    totalWithdrawals,
    currentBalance: totalDeposits - totalWithdrawals,
    depositsOverTime,
    withdrawalsOverTime,
    pendingWithdrawals,
    pendingDeposits,
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
