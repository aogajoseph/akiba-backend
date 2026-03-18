import {
  Approval,
  ApprovalStatus,
  Group,
  GroupMember,
  GroupRole,
  Message,
  Transaction,
  TransactionStatus,
  TransactionType,
  User,
} from '../../../shared/contracts';

export const users: User[] = [
  {
    id: 'user_1',
    phoneNumber: '+254700000001',
    name: 'Amina',
    createdAt: new Date().toISOString(),
  },
];

export const groups: Group[] = [
  {
    id: 'group_1',
    name: 'Sunday Savers',
    createdByUserId: 'user_1',
    approvalThreshold: 2,
    createdAt: new Date().toISOString(),
  },
];

export const groupMembers: GroupMember[] = [
  {
    id: 'member_1',
    groupId: 'group_1',
    userId: 'user_1',
    role: GroupRole.SIGNATORY,
    joinedAt: new Date().toISOString(),
  },
];

export const transactions: Transaction[] = [
  {
    id: 'txn_1',
    groupId: 'group_1',
    initiatedByUserId: 'user_1',
    type: TransactionType.DEPOSIT,
    amount: 2500,
    currency: 'KES',
    description: 'Initial contribution',
    status: TransactionStatus.COMPLETED,
    createdAt: new Date().toISOString(),
  },
  {
    id: 'txn_2',
    groupId: 'group_1',
    initiatedByUserId: 'user_1',
    type: TransactionType.WITHDRAWAL,
    amount: 1000,
    currency: 'KES',
    description: 'Emergency support',
    destination: 'M-Pesa 0712345678',
    status: TransactionStatus.PENDING_APPROVAL,
    createdAt: new Date().toISOString(),
  },
];

export const approvals: Approval[] = [
  {
    id: 'approval_1',
    transactionId: 'txn_2',
    signatoryUserId: 'user_1',
    status: ApprovalStatus.APPROVED,
    createdAt: new Date().toISOString(),
  },
];

export const messages: Message[] = [
  {
    id: 'message_1',
    groupId: 'group_1',
    senderUserId: 'user_1',
    text: 'Welcome to the group.',
    createdAt: new Date().toISOString(),
  },
];
