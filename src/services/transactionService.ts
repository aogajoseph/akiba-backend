import type { Prisma } from '@prisma/client';
import {
  CreateDepositRequestDto,
  CreateWithdrawalRequestDto,
  GetTransactionsSummaryResponseDto,
  Transaction,
  TransactionSource,
  TransactionStatus,
  TransactionType,
} from '../../../shared/contracts';
import { prisma } from '../lib/prisma';
import { transactions } from '../data/store';
import { createId } from '../utils/http';
import { createDeposit as createSpaceDeposit } from './groupService';

const mapDbTransactionToContractTransaction = (transaction: {
  amount: Prisma.Decimal | number;
  createdAt: Date;
  externalName: string | null;
  id: string;
  phoneNumber: string | null;
  reference: string;
  source: TransactionSource | string;
  spaceId: string;
  status: TransactionStatus | string;
  type: TransactionType | string;
  userId: string | null;
}): Transaction => {
  const amount =
    typeof transaction.amount === 'number'
      ? transaction.amount
      : Number(transaction.amount);

  return {
    id: transaction.id,
    spaceId: transaction.spaceId,
    userId: transaction.userId ?? undefined,
    groupId: transaction.spaceId,
    initiatedByUserId: transaction.userId ?? `external_${transaction.id}`,
    type: transaction.type as TransactionType,
    amount,
    reference: transaction.reference,
    source: transaction.source as TransactionSource,
    phoneNumber: transaction.phoneNumber ?? undefined,
    externalName: transaction.externalName ?? undefined,
    status: transaction.status as TransactionStatus,
    createdAt: transaction.createdAt.toISOString(),
    currency: 'KES',
  };
};

const mergeTransactions = (
  persistedTransactions: Transaction[],
  legacyTransactions: Transaction[],
): Transaction[] => {
  const persistedIds = new Set(persistedTransactions.map((item) => item.id));
  const persistedReferences = new Set(persistedTransactions.map((item) => item.reference));
  const uniqueLegacyTransactions = legacyTransactions.filter(
    (item) => !persistedIds.has(item.id) && !persistedReferences.has(item.reference),
  );

  return [...persistedTransactions, ...uniqueLegacyTransactions].sort(
    (left, right) =>
      new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
  );
};

export const createDeposit = async (
  groupId: string,
  userId: string,
  dto: CreateDepositRequestDto,
): Promise<Transaction> => {
  const transaction = await createSpaceDeposit(groupId, userId, dto.amount, {
    source: TransactionSource.MPESA_STK,
  });

  return {
    ...transaction,
    currency: dto.currency,
    description: dto.description,
  };
};

export const createWithdrawal = (
  groupId: string,
  userId: string,
  dto: CreateWithdrawalRequestDto,
): Transaction => {
  const transaction: Transaction = {
    id: createId('txn'),
    spaceId: groupId,
    userId,
    groupId,
    initiatedByUserId: userId,
    type: TransactionType.WITHDRAWAL,
    amount: dto.amount,
    reference: createId('withdrawal_ref'),
    source: TransactionSource.BANK_TRANSFER,
    currency: dto.currency,
    description: dto.description,
    destination: dto.destination,
    status: TransactionStatus.PENDING_APPROVAL,
    createdAt: new Date().toISOString(),
  };

  transactions.push(transaction);

  return transaction;
};

export const listTransactions = async (groupId: string): Promise<Transaction[]> => {
  const persistedTransactions = await prisma.transaction.findMany({
    where: {
      spaceId: groupId,
    },
    orderBy: {
      createdAt: 'desc',
    },
  });
  const mappedPersistedTransactions = persistedTransactions.map(
    mapDbTransactionToContractTransaction,
  );
  const legacyTransactions = transactions.filter((item) => item.groupId === groupId);

  return mergeTransactions(mappedPersistedTransactions, legacyTransactions);
};

export const getTransaction = (
  groupId: string,
  transactionId: string,
): Promise<Transaction | undefined> => {
  return prisma.transaction.findUnique({
    where: {
      id: transactionId,
    },
  }).then((transaction) => {
    if (transaction && transaction.spaceId === groupId) {
      return mapDbTransactionToContractTransaction(transaction);
    }

    return transactions.find(
      (item) => item.groupId === groupId && item.id === transactionId,
    );
  });
};

const isCompletedTransaction = (transaction: Transaction): boolean => {
  return transaction.status === TransactionStatus.COMPLETED;
};

const buildRunningTotals = (
  transactionsByGroup: Transaction[],
  type: TransactionType,
): Array<{ date: string; amount: number }> => {
  const relevantTransactions = transactionsByGroup
    .filter(
      (transaction) =>
        transaction.type === type &&
        isCompletedTransaction(transaction),
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

export const getTransactionsSummary = async (
  groupId: string,
): Promise<GetTransactionsSummaryResponseDto> => {
  const allTransactions = await listTransactions(groupId);
  const completedTransactions = allTransactions.filter(isCompletedTransaction);
  const totalDeposits = completedTransactions
    .filter((transaction) => transaction.type === TransactionType.DEPOSIT)
    .reduce((sum, transaction) => sum + transaction.amount, 0);
  const totalWithdrawals = completedTransactions
    .filter((transaction) => transaction.type === TransactionType.WITHDRAWAL)
    .reduce((sum, transaction) => sum + transaction.amount, 0);

  return {
    totalDeposits,
    totalWithdrawals,
    currentBalance: totalDeposits - totalWithdrawals,
    depositsOverTime: buildRunningTotals(allTransactions, TransactionType.DEPOSIT),
    withdrawalsOverTime: buildRunningTotals(allTransactions, TransactionType.WITHDRAWAL),
    pendingWithdrawals: [],
  };
};
