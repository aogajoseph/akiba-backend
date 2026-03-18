import {
  Approval,
  Group,
  GroupMember,
  GroupRole,
  Message,
  Transaction,
  TransactionStatus,
  TransactionType,
  User,
} from '../../../shared/contracts';

const now = new Date().toISOString();

export const users: User[] = [
  {
    id: 'user_1',
    phoneNumber: '+254700000001',
    name: 'Amina',
    createdAt: now,
  },
  {
    id: 'user_2',
    phoneNumber: '+254700000002',
    name: 'Brian',
    createdAt: now,
  },
  {
    id: 'user_3',
    phoneNumber: '+254700000003',
    name: 'Caro',
    createdAt: now,
  },
];

export const groups: Group[] = [
  {
    id: 'group_1',
    name: 'Sunday Savers',
    createdByUserId: 'user_1',
    approvalThreshold: 2,
    createdAt: now,
  },
];

export const groupMembers: GroupMember[] = [
  {
    id: 'member_1',
    groupId: 'group_1',
    userId: 'user_1',
    role: GroupRole.SIGNATORY,
    joinedAt: now,
  },
  {
    id: 'member_2',
    groupId: 'group_1',
    userId: 'user_2',
    role: GroupRole.SIGNATORY,
    joinedAt: now,
  },
  {
    id: 'member_3',
    groupId: 'group_1',
    userId: 'user_3',
    role: GroupRole.MEMBER,
    joinedAt: now,
  },
];

export const transactions: Transaction[] = [
  {
    id: 'txn_1',
    groupId: 'group_1',
    initiatedByUserId: 'user_3',
    type: TransactionType.DEPOSIT,
    amount: 2500,
    currency: 'KES',
    description: 'Initial contribution',
    status: TransactionStatus.COMPLETED,
    createdAt: now,
  },
  {
    id: 'txn_2',
    groupId: 'group_1',
    initiatedByUserId: 'user_3',
    type: TransactionType.WITHDRAWAL,
    amount: 1000,
    currency: 'KES',
    description: 'Emergency support',
    destination: 'M-Pesa 0712345678',
    status: TransactionStatus.PENDING_APPROVAL,
    createdAt: now,
  },
];

export const approvals: Approval[] = [];

export const messages: Message[] = [
  {
    id: 'message_1',
    groupId: 'group_1',
    senderUserId: 'user_1',
    text: 'Welcome to the group.',
    createdAt: now,
  },
  {
    id: 'message_2',
    groupId: 'group_1',
    senderUserId: 'user_3',
    text: 'I have added my first contribution.',
    createdAt: now,
  },
];
