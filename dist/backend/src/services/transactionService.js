"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTransactionsSummary = exports.getTransaction = exports.listTransactions = exports.createWithdrawal = exports.createDeposit = void 0;
const contracts_1 = require("../../../shared/contracts");
const store_1 = require("../data/store");
const http_1 = require("../utils/http");
const createDeposit = (groupId, userId, dto) => {
    const transaction = {
        id: (0, http_1.createId)('txn'),
        groupId,
        initiatedByUserId: userId,
        type: contracts_1.TransactionType.DEPOSIT,
        amount: dto.amount,
        currency: dto.currency,
        description: dto.description,
        status: contracts_1.TransactionStatus.COMPLETED,
        createdAt: new Date().toISOString(),
    };
    store_1.transactions.push(transaction);
    return transaction;
};
exports.createDeposit = createDeposit;
const createWithdrawal = (groupId, userId, dto) => {
    const transaction = {
        id: (0, http_1.createId)('txn'),
        groupId,
        initiatedByUserId: userId,
        type: contracts_1.TransactionType.WITHDRAWAL,
        amount: dto.amount,
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
const listTransactions = (groupId) => {
    return store_1.transactions.filter((item) => item.groupId === groupId);
};
exports.listTransactions = listTransactions;
const getTransaction = (groupId, transactionId) => {
    return store_1.transactions.find((item) => item.groupId === groupId && item.id === transactionId);
};
exports.getTransaction = getTransaction;
const isApprovedTransaction = (transaction) => {
    return (transaction.status === contracts_1.TransactionStatus.APPROVED ||
        transaction.status === contracts_1.TransactionStatus.COMPLETED);
};
const buildRunningTotals = (groupId, type) => {
    const relevantTransactions = store_1.transactions
        .filter((transaction) => transaction.groupId === groupId &&
        transaction.type === type &&
        isApprovedTransaction(transaction))
        .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());
    if (relevantTransactions.length === 0) {
        return [0];
    }
    let runningTotal = 0;
    return relevantTransactions.map((transaction) => {
        runningTotal += transaction.amount;
        return runningTotal;
    });
};
const getTransactionsSummary = (groupId) => {
    const approvedTransactions = store_1.transactions.filter((transaction) => transaction.groupId === groupId && isApprovedTransaction(transaction));
    const totalDeposits = approvedTransactions
        .filter((transaction) => transaction.type === contracts_1.TransactionType.DEPOSIT)
        .reduce((sum, transaction) => sum + transaction.amount, 0);
    const totalWithdrawals = approvedTransactions
        .filter((transaction) => transaction.type === contracts_1.TransactionType.WITHDRAWAL)
        .reduce((sum, transaction) => sum + transaction.amount, 0);
    return {
        totalDeposits,
        totalWithdrawals,
        currentBalance: totalDeposits - totalWithdrawals,
        depositsOverTime: buildRunningTotals(groupId, contracts_1.TransactionType.DEPOSIT),
        withdrawalsOverTime: buildRunningTotals(groupId, contracts_1.TransactionType.WITHDRAWAL),
    };
};
exports.getTransactionsSummary = getTransactionsSummary;
