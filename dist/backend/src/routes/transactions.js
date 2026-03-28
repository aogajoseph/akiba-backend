"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const store_1 = require("../data/store");
const http_1 = require("../utils/http");
const transactionService_1 = require("../services/transactionService");
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
const parseDepositDto = (body) => {
    return {
        amount: (0, http_1.ensurePositiveNumber)(body.amount, 'amount must be a positive number'),
        currency: (0, http_1.ensureNonEmptyString)(body.currency, 'currency is required'),
        description: body.description === undefined
            ? undefined
            : (0, http_1.ensureNonEmptyString)(body.description, 'description must be a non-empty string'),
    };
};
const parseWithdrawalDto = (body) => {
    return {
        amount: (0, http_1.ensurePositiveNumber)(body.amount, 'amount must be a positive number'),
        currency: (0, http_1.ensureNonEmptyString)(body.currency, 'currency is required'),
        description: body.description === undefined
            ? undefined
            : (0, http_1.ensureNonEmptyString)(body.description, 'description must be a non-empty string'),
        destination: (0, http_1.ensureNonEmptyString)(body.destination, 'destination is required'),
    };
};
const requireTransaction = (groupId, transactionId) => {
    const transaction = (0, transactionService_1.getTransaction)(groupId, transactionId);
    if (!transaction) {
        throw (0, http_1.createHttpError)(404, 'Transaction not found');
    }
    return transaction;
};
router.post('/deposits', (req, res, next) => {
    try {
        const { groupId } = req.params;
        const user = getCurrentUser(req.header('x-user-id'));
        getGroupById(groupId);
        requireMembership(groupId, user.id);
        const dto = parseDepositDto((0, http_1.getObjectBody)(req.body));
        const transaction = (0, transactionService_1.createDeposit)(groupId, user.id, dto);
        const response = {
            data: {
                transaction,
            },
        };
        res.status(201).json(response);
    }
    catch (error) {
        next(error);
    }
});
router.post('/withdrawals', (req, res, next) => {
    try {
        const { groupId } = req.params;
        const user = getCurrentUser(req.header('x-user-id'));
        getGroupById(groupId);
        requireMembership(groupId, user.id);
        const dto = parseWithdrawalDto((0, http_1.getObjectBody)(req.body));
        const transaction = (0, transactionService_1.createWithdrawal)(groupId, user.id, dto);
        const response = {
            data: {
                transaction,
            },
        };
        res.status(201).json(response);
    }
    catch (error) {
        next(error);
    }
});
router.get('/', (req, res, next) => {
    try {
        const { groupId } = req.params;
        const user = getCurrentUser(req.header('x-user-id'));
        getGroupById(groupId);
        requireMembership(groupId, user.id);
        const response = {
            data: {
                transactions: (0, transactionService_1.listTransactions)(groupId),
            },
        };
        res.json(response);
    }
    catch (error) {
        next(error);
    }
});
router.get('/summary', (req, res, next) => {
    try {
        const { groupId } = req.params;
        const user = getCurrentUser(req.header('x-user-id'));
        getGroupById(groupId);
        requireMembership(groupId, user.id);
        const response = {
            data: (0, transactionService_1.getTransactionsSummary)(groupId),
        };
        res.json(response);
    }
    catch (error) {
        next(error);
    }
});
router.get('/:transactionId', (req, res, next) => {
    try {
        const { groupId, transactionId } = req.params;
        const user = getCurrentUser(req.header('x-user-id'));
        getGroupById(groupId);
        requireMembership(groupId, user.id);
        const transaction = requireTransaction(groupId, transactionId);
        const response = {
            data: {
                transaction,
            },
        };
        res.json(response);
    }
    catch (error) {
        next(error);
    }
});
exports.default = router;
