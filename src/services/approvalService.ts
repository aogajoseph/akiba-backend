import {
  Approval,
  ApprovalStatus,
  CreateApprovalRequestDto,
  TransactionStatus,
} from '../../../shared/contracts';
import { approvals, groups, transactions } from '../data/store';
import { createId } from '../utils/http';

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
  const approval: Approval = {
    id: createId('approval'),
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
