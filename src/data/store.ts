import {
  Approval,
  Group,
  GroupMember,
  Transaction,
} from '../../../shared/contracts';

export const groups: Group[] = [];
export const groupMembers: GroupMember[] = [];
export const transactions: Transaction[] = [];
export const approvals: Approval[] = [];
export const typingUsers: Record<string, Map<string, number>> = {};
