"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTransactionsSummary = exports.getTransaction = exports.listTransactions = exports.createWithdrawal = exports.createDeposit = void 0;
const contracts_1 = require("../../../shared/contracts");
const prisma_1 = require("../lib/prisma");
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
        description: transaction.description ?? undefined,
        destination: transaction.destination ?? undefined,
    };
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
const createWithdrawal = async (groupId, userId, dto) => {
    const transaction = await (0, groupService_1.createWithdrawal)(groupId, userId, dto.amount, dto.description);
    return {
        ...transaction,
        currency: dto.currency,
        description: dto.description,
        destination: dto.destination,
    };
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
    return persistedTransactions.map(mapDbTransactionToContractTransaction);
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
        return undefined;
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
    const totalFees = completedTransactions
        .filter((transaction) => transaction.type === contracts_1.TransactionType.FEE)
        .reduce((sum, transaction) => sum + transaction.amount, 0);
    return {
        totalDeposits,
        totalWithdrawals,
        currentBalance: totalDeposits - totalWithdrawals - totalFees,
        depositsOverTime: buildRunningTotals(allTransactions, contracts_1.TransactionType.DEPOSIT),
        withdrawalsOverTime: buildRunningTotals(allTransactions, contracts_1.TransactionType.WITHDRAWAL),
        pendingWithdrawals: [],
    };
};
exports.getTransactionsSummary = getTransactionsSummary;
