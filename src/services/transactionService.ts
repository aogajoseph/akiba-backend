import {
  CreateDepositRequestDto,
  CreateWithdrawalRequestDto,
  GetTransactionsSummaryResponseDto,
  Transaction,
  TransactionStatus,
  TransactionType,
} from '../../../shared/contracts';
import { transactions } from '../data/store';
import { createId } from '../utils/http';

export const createDeposit = (
  groupId: string,
  userId: string,
  dto: CreateDepositRequestDto,
): Transaction => {
  const transaction: Transaction = {
    id: createId('txn'),
    groupId,
    initiatedByUserId: userId,
    type: TransactionType.DEPOSIT,
    amount: dto.amount,
    currency: dto.currency,
    description: dto.description,
    status: TransactionStatus.COMPLETED,
    createdAt: new Date().toISOString(),
  };

  transactions.push(transaction);

  return transaction;
};

export const createWithdrawal = (
  groupId: string,
  userId: string,
  dto: CreateWithdrawalRequestDto,
): Transaction => {
  const transaction: Transaction = {
    id: createId('txn'),
    groupId,
    initiatedByUserId: userId,
    type: TransactionType.WITHDRAWAL,
    amount: dto.amount,
    currency: dto.currency,
    description: dto.description,
    destination: dto.destination,
    status: TransactionStatus.PENDING_APPROVAL,
    createdAt: new Date().toISOString(),
  };

  transactions.push(transaction);

  return transaction;
};

export const listTransactions = (groupId: string): Transaction[] => {
  return transactions.filter((item) => item.groupId === groupId);
};

export const getTransaction = (
  groupId: string,
  transactionId: string,
): Transaction | undefined => {
  return transactions.find(
    (item) => item.groupId === groupId && item.id === transactionId,
  );
};

const isApprovedTransaction = (transaction: Transaction): boolean => {
  return (
    transaction.status === TransactionStatus.APPROVED ||
    transaction.status === TransactionStatus.COMPLETED
  );
};

const buildRunningTotals = (
  groupId: string,
  type: TransactionType,
): Array<{ date: string; amount: number }> => {
  const relevantTransactions = transactions
    .filter(
      (transaction) =>
        transaction.groupId === groupId &&
        transaction.type === type &&
        isApprovedTransaction(transaction),
    )
    .sort(
      (left, right) =>
        new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime(),
    );

  if (relevantTransactions.length === 0) {
    return [];
  }

  const totalsByDate: Record<string, number> = {};

  relevantTransactions.forEach((transaction) => {
    const date = new Date(transaction.createdAt).toISOString().split('T')[0];
    totalsByDate[date] = (totalsByDate[date] || 0) + transaction.amount;
  });

  return Object.keys(totalsByDate)
    .sort()
    .map((date) => ({
      date,
      amount: totalsByDate[date],
    }));
};

export const getTransactionsSummary = (
  groupId: string,
): GetTransactionsSummaryResponseDto => {
  const approvedTransactions = transactions.filter(
    (transaction) => transaction.groupId === groupId && isApprovedTransaction(transaction),
  );
  const totalDeposits = approvedTransactions
    .filter((transaction) => transaction.type === TransactionType.DEPOSIT)
    .reduce((sum, transaction) => sum + transaction.amount, 0);
  const totalWithdrawals = approvedTransactions
    .filter((transaction) => transaction.type === TransactionType.WITHDRAWAL)
    .reduce((sum, transaction) => sum + transaction.amount, 0);

  return {
    totalDeposits,
    totalWithdrawals,
    currentBalance: totalDeposits - totalWithdrawals,
    depositsOverTime: buildRunningTotals(groupId, TransactionType.DEPOSIT),
    withdrawalsOverTime: buildRunningTotals(groupId, TransactionType.WITHDRAWAL),
    pendingWithdrawals: [],
  };
};
