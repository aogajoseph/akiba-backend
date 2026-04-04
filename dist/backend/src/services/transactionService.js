"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTransactionsSummary = exports.getTransaction = exports.listTransactions = exports.createWithdrawal = exports.createDeposit = void 0;
const contracts_1 = require("../../../shared/contracts");
const prisma_1 = require("../lib/prisma");
const store_1 = require("../data/store");
const http_1 = require("../utils/http");
const groupService_1 = require("./groupService");
const mapDbTransactionToContractTransaction = (transaction) => {
    const amount = typeof transaction.amount === 'number'
        ? transaction.amount
        : Number(transaction.amount);
    return {
        id: transaction.id,
        spaceId: transaction.spaceId,
        userId: transaction.userId ?? undefined,
        groupId: transaction.spaceId,
        initiatedByUserId: transaction.userId ?? `external_${transaction.id}`,
        type: transaction.type,
        amount,
        reference: transaction.reference,
        source: transaction.source,
        phoneNumber: transaction.phoneNumber ?? undefined,
        externalName: transaction.externalName ?? undefined,
        status: transaction.status,
        createdAt: transaction.createdAt.toISOString(),
        currency: 'KES',
    };
};
const mergeTransactions = (persistedTransactions, legacyTransactions) => {
    const persistedIds = new Set(persistedTransactions.map((item) => item.id));
    const persistedReferences = new Set(persistedTransactions.map((item) => item.reference));
    const uniqueLegacyTransactions = legacyTransactions.filter((item) => !persistedIds.has(item.id) && !persistedReferences.has(item.reference));
    return [...persistedTransactions, ...uniqueLegacyTransactions].sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
};
const createDeposit = async (groupId, userId, dto) => {
    const transaction = await (0, groupService_1.createDeposit)(groupId, userId, dto.amount, {
        source: contracts_1.TransactionSource.MPESA_STK,
    });
    return {
        ...transaction,
        currency: dto.currency,
        description: dto.description,
    };
};
exports.createDeposit = createDeposit;
const createWithdrawal = (groupId, userId, dto) => {
    const transaction = {
        id: (0, http_1.createId)('txn'),
        spaceId: groupId,
        userId,
        groupId,
        initiatedByUserId: userId,
        type: contracts_1.TransactionType.WITHDRAWAL,
        amount: dto.amount,
        reference: (0, http_1.createId)('withdrawal_ref'),
        source: contracts_1.TransactionSource.BANK_TRANSFER,
        currency: dto.currency,
        description: dto.description,
        destination: dto.destination,
        status: contracts_1.TransactionStatus.PENDING_APPROVAL,
        createdAt: new Date().toISOString(),
    };
    store_1.transactions.push(transaction);
    return transaction;
};
exports.createWithdrawal = createWithdrawal;
const listTransactions = async (groupId) => {
    const persistedTransactions = await prisma_1.prisma.transaction.findMany({
        where: {
            spaceId: groupId,
        },
        orderBy: {
            createdAt: 'desc',
        },
    });
    const mappedPersistedTransactions = persistedTransactions.map(mapDbTransactionToContractTransaction);
    const legacyTransactions = store_1.transactions.filter((item) => item.groupId === groupId);
    return mergeTransactions(mappedPersistedTransactions, legacyTransactions);
};
exports.listTransactions = listTransactions;
const getTransaction = (groupId, transactionId) => {
    return prisma_1.prisma.transaction.findUnique({
        where: {
            id: transactionId,
        },
    }).then((transaction) => {
        if (transaction && transaction.spaceId === groupId) {
            return mapDbTransactionToContractTransaction(transaction);
        }
        return store_1.transactions.find((item) => item.groupId === groupId && item.id === transactionId);
    });
};
exports.getTransaction = getTransaction;
const isCompletedTransaction = (transaction) => {
    return transaction.status === contracts_1.TransactionStatus.COMPLETED;
};
const buildRunningTotals = (transactionsByGroup, type) => {
    const relevantTransactions = transactionsByGroup
        .filter((transaction) => transaction.type === type &&
        isCompletedTransaction(transaction))
        .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());
    if (relevantTransactions.length === 0) {
        return [];
    }
    const totalsByDate = {};
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
const getTransactionsSummary = async (groupId) => {
    const allTransactions = await (0, exports.listTransactions)(groupId);
    const completedTransactions = allTransactions.filter(isCompletedTransaction);
    const totalDeposits = completedTransactions
        .filter((transaction) => transaction.type === contracts_1.TransactionType.DEPOSIT)
        .reduce((sum, transaction) => sum + transaction.amount, 0);
    const totalWithdrawals = completedTransactions
        .filter((transaction) => transaction.type === contracts_1.TransactionType.WITHDRAWAL)
        .reduce((sum, transaction) => sum + transaction.amount, 0);
    return {
        totalDeposits,
        totalWithdrawals,
        currentBalance: totalDeposits - totalWithdrawals,
        depositsOverTime: buildRunningTotals(allTransactions, contracts_1.TransactionType.DEPOSIT),
        withdrawalsOverTime: buildRunningTotals(allTransactions, contracts_1.TransactionType.WITHDRAWAL),
        pendingWithdrawals: [],
    };
};
exports.getTransactionsSummary = getTransactionsSummary;
