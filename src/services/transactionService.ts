import {
  CreateDepositRequestDto,
  CreateWithdrawalRequestDto,
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
