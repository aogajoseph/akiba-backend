import {
  Approval,
  Group,
  GroupMember,
  Message,
  Transaction,
} from '../../../shared/contracts';

export const groups: Group[] = [];
export const groupMembers: GroupMember[] = [];
export const transactions: Transaction[] = [];
export const approvals: Approval[] = [];
export const messages: Message[] = [];
export const typingUsers: Record<string, Set<string>> = {};
