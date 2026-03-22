"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listApprovals = exports.createApproval = void 0;
const contracts_1 = require("../../../shared/contracts");
const store_1 = require("../data/store");
const http_1 = require("../utils/http");
const updateWithdrawalStatus = (transactionId) => {
    const transaction = store_1.transactions.find((item) => item.id === transactionId);
    if (!transaction) {
        throw new Error('Transaction not found');
    }
    const group = store_1.groups.find((item) => item.id === transaction.groupId);
    if (!group) {
        throw new Error('Group not found');
    }
    const transactionApprovals = store_1.approvals.filter((item) => item.transactionId === transactionId);
    const hasRejection = transactionApprovals.some((item) => item.status === contracts_1.ApprovalStatus.REJECTED);
    const approvalCount = transactionApprovals.filter((item) => item.status === contracts_1.ApprovalStatus.APPROVED).length;
    if (hasRejection) {
        transaction.status = contracts_1.TransactionStatus.REJECTED;
        return;
    }
    if (approvalCount >= group.approvalThreshold) {
        transaction.status = contracts_1.TransactionStatus.APPROVED;
        return;
    }
    transaction.status = contracts_1.TransactionStatus.PENDING_APPROVAL;
};
const createApproval = (transactionId, signatoryUserId, dto) => {
    const approval = {
        id: (0, http_1.createId)('approval'),
        transactionId,
        signatoryUserId,
        status: dto.status,
        createdAt: new Date().toISOString(),
    };
    store_1.approvals.push(approval);
    updateWithdrawalStatus(transactionId);
    return approval;
};
exports.createApproval = createApproval;
const listApprovals = (transactionId) => {
    return store_1.approvals.filter((item) => item.transactionId === transactionId);
};
exports.listApprovals = listApprovals;
