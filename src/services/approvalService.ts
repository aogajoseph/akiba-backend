import {
  Approval,
  ApprovalStatus,
  CreateApprovalRequestDto,
  GroupRole,
  TransactionStatus,
  TransactionType,
} from '../../../shared/contracts';
import { approvals, groupMembers, groups, transactions } from '../data/store';

const createApprovalId = () => `approval_${Date.now()}`;

const updateWithdrawalStatus = (transactionId: string): void => {
  const transaction = transactions.find((item) => item.id === transactionId);

  if (!transaction) {
    throw new Error('Transaction not found');
  }

  const group = groups.find((item) => item.id === transaction.groupId);

  if (!group) {
    throw new Error('Group not found');
  }

  const transactionApprovals = approvals.filter((item) => item.transactionId === transactionId);
  const hasRejection = transactionApprovals.some(
    (item) => item.status === ApprovalStatus.REJECTED,
  );
  const approvalCount = transactionApprovals.filter(
    (item) => item.status === ApprovalStatus.APPROVED,
  ).length;

  if (hasRejection) {
    transaction.status = TransactionStatus.REJECTED;
    return;
  }

  if (approvalCount >= group.approvalThreshold) {
    transaction.status = TransactionStatus.APPROVED;
    return;
  }

  transaction.status = TransactionStatus.PENDING_APPROVAL;
};

export const createApproval = (
  transactionId: string,
  signatoryUserId: string,
  dto: CreateApprovalRequestDto,
): Approval => {
  const transaction = transactions.find((item) => item.id === transactionId);

  if (!transaction) {
    throw new Error('Transaction not found');
  }

  if (transaction.type !== TransactionType.WITHDRAWAL) {
    throw new Error('Only withdrawals can be approved');
  }

  const membership = groupMembers.find(
    (item) =>
      item.groupId === transaction.groupId &&
      item.userId === signatoryUserId &&
      item.role === GroupRole.SIGNATORY,
  );

  if (!membership) {
    throw new Error('Only signatories can approve or reject transactions');
  }

  const existingApproval = approvals.find(
    (item) =>
      item.transactionId === transactionId && item.signatoryUserId === signatoryUserId,
  );

  if (existingApproval) {
    throw new Error('Signatory has already approved or rejected this transaction');
  }

  const approval: Approval = {
    id: createApprovalId(),
    transactionId,
    signatoryUserId,
    status: dto.status,
    createdAt: new Date().toISOString(),
  };

  approvals.push(approval);
  updateWithdrawalStatus(transactionId);

  return approval;
};

export const listApprovals = (transactionId: string): Approval[] => {
  return approvals.filter((item) => item.transactionId === transactionId);
};
