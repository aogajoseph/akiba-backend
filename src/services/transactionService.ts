import {
  CreateDepositRequestDto,
  CreateWithdrawalRequestDto,
  Transaction,
  TransactionStatus,
  TransactionType,
} from '../../../shared/contracts';
import { groups, transactions } from '../data/store';

const createTransactionId = () => `txn_${Date.now()}`;

export const createDeposit = (
  groupId: string,
  userId: string,
  dto: CreateDepositRequestDto,
): Transaction => {
  const group = groups.find((item) => item.id === groupId);

  if (!group) {
    throw new Error('Group not found');
  }

  const transaction: Transaction = {
    id: createTransactionId(),
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
  const group = groups.find((item) => item.id === groupId);

  if (!group) {
    throw new Error('Group not found');
  }

  const transaction: Transaction = {
    id: createTransactionId(),
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

export const getTransaction = (groupId: string, transactionId: string): Transaction => {
  const transaction = transactions.find(
    (item) => item.groupId === groupId && item.id === transactionId,
  );

  if (!transaction) {
    throw new Error('Transaction not found');
  }

  return transaction;
};
