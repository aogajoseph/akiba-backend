"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const contracts_1 = require("../../../shared/contracts");
const store_1 = require("../data/store");
const http_1 = require("../utils/http");
const transactionService_1 = require("../services/transactionService");
const approvalService_1 = require("../services/approvalService");
const router = (0, express_1.Router)({ mergeParams: true });
const getCurrentUser = (headerValue) => {
    const userId = (0, http_1.ensureNonEmptyString)(headerValue, 'x-user-id header is required');
    const user = store_1.users.find((item) => item.id === userId);
    if (!user) {
        throw (0, http_1.createHttpError)(404, 'User not found');
    }
    return user;
};
const getGroupById = (groupId) => {
    const group = store_1.groups.find((item) => item.id === groupId);
    if (!group) {
        throw (0, http_1.createHttpError)(404, 'Group not found');
    }
    return group;
};
const requireMembership = (groupId, userId) => {
    const membership = store_1.groupMembers.find((item) => item.groupId === groupId && item.userId === userId);
    if (!membership) {
        throw (0, http_1.createHttpError)(403, 'You are not a member of this group');
    }
    return membership;
};
const requireTransactionById = (transactionId) => {
    const transaction = store_1.transactions.find((item) => item.id === transactionId);
    if (!transaction) {
        throw (0, http_1.createHttpError)(404, 'Transaction not found');
    }
    return transaction;
};
const requireTransactionInGroup = (groupId, transactionId) => {
    const transaction = (0, transactionService_1.getTransaction)(groupId, transactionId);
    if (!transaction) {
        throw (0, http_1.createHttpError)(404, 'Transaction not found');
    }
    return transaction;
};
router.get('/', (req, res, next) => {
    try {
        const { groupId, transactionId } = req.params;
        const user = getCurrentUser(req.header('x-user-id'));
        getGroupById(groupId);
        requireMembership(groupId, user.id);
        const transaction = requireTransactionById(transactionId);
        if (transaction.groupId !== groupId) {
            throw (0, http_1.createHttpError)(400, 'groupId does not match the transaction group');
        }
        const response = {
            data: {
                approvals: (0, approvalService_1.listApprovals)(transactionId),
            },
        };
        res.json(response);
    }
    catch (error) {
        next(error);
    }
});
router.post('/', (req, res, next) => {
    try {
        const { groupId, transactionId } = req.params;
        const user = getCurrentUser(req.header('x-user-id'));
        const group = getGroupById(groupId);
        const membership = requireMembership(groupId, user.id);
        const transaction = requireTransactionById(transactionId);
        if (transaction.groupId !== group.id) {
            throw (0, http_1.createHttpError)(400, 'groupId does not match the transaction group');
        }
        if (transaction.type !== contracts_1.TransactionType.WITHDRAWAL) {
            throw (0, http_1.createHttpError)(400, 'Only withdrawals can be approved');
        }
        if (membership.role !== contracts_1.GroupRole.SIGNATORY) {
            throw (0, http_1.createHttpError)(403, 'Only signatories can approve or reject withdrawals');
        }
        if (transaction.status !== contracts_1.TransactionStatus.PENDING_APPROVAL) {
            throw (0, http_1.createHttpError)(409, 'Only pending withdrawals can be approved or rejected');
        }
        const existingApproval = store_1.approvals.find((item) => item.transactionId === transaction.id && item.signatoryUserId === user.id);
        if (existingApproval) {
            throw (0, http_1.createHttpError)(409, 'You have already approved or rejected this withdrawal');
        }
        const body = (0, http_1.getObjectBody)(req.body);
        const dto = {
            status: (0, http_1.ensureEnumValue)(body.status, [contracts_1.ApprovalStatus.APPROVED, contracts_1.ApprovalStatus.REJECTED], 'status must be approved or rejected'),
        };
        const approval = (0, approvalService_1.createApproval)(transaction.id, user.id, dto);
        const updatedTransaction = requireTransactionInGroup(groupId, transactionId);
        const response = {
            data: {
                approval,
                transaction: updatedTransaction,
            },
        };
        res.status(201).json(response);
    }
    catch (error) {
        next(error);
    }
});
exports.default = router;
