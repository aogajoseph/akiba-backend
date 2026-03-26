import {
  CreateGroupRequestDto,
  Group,
  GroupMember,
  GroupRole,
  GroupSignatory,
  SignatoryRole,
  TransactionStatus,
} from '../../../shared/contracts';
import { approvals, groupMembers, groups, messages, transactions, users } from '../data/store';
import { createHttpError, createId } from '../utils/http';

const MAX_SIGNATORIES = 3;
const JOINABLE_SIGNATORY_ROLES: Exclude<SignatoryRole, null>[] = [
  'primary',
  'secondary',
  'tertiary',
];
const PROMOTABLE_SIGNATORY_ROLES: Exclude<SignatoryRole, null>[] = ['secondary', 'tertiary'];

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
