"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const contracts_1 = require("../../../shared/contracts");
const prisma_1 = require("../lib/prisma");
const http_1 = require("../utils/http");
const auth_1 = require("../utils/auth");
const transactionService_1 = require("../services/transactionService");
const router = (0, express_1.Router)({ mergeParams: true });
const getCurrentUser = async (headerValue) => {
    const userId = (0, http_1.ensureNonEmptyString)(headerValue, 'x-user-id header is required');
    return (0, auth_1.getCurrentUserOrThrow)(userId);
};
const getGroupById = async (groupId) => {
    const space = await prisma_1.prisma.space.findUnique({
        where: {
            id: groupId,
        },
    });
    if (!space) {
        throw (0, http_1.createHttpError)(404, 'Group not found');
    }
    return {
        id: space.id,
        name: space.name,
        description: space.description ?? undefined,
        imageUrl: space.imageUrl ?? undefined,
        paybillNumber: space.paybillNumber ?? process.env.MPESA_PAYBILL?.trim() ?? '522522',
        accountNumber: space.accountNumber ?? '',
        targetAmount: space.targetAmount ?? undefined,
        collectedAmount: 0,
        deadline: space.deadline?.toISOString(),
        createdByUserId: space.createdById,
        approvalThreshold: space.approvalThreshold,
        createdAt: space.createdAt.toISOString(),
    };
};
const requireMembership = async (groupId, userId) => {
    const membership = await prisma_1.prisma.spaceMember.findFirst({
        where: {
            spaceId: groupId,
            userId,
        },
    });
    if (!membership) {
        throw (0, http_1.createHttpError)(403, 'You are not a member of this group');
    }
    return {
        id: membership.id,
        groupId: membership.spaceId,
        userId: membership.userId,
        role: membership.role === 'admin' ? contracts_1.GroupRole.SIGNATORY : contracts_1.GroupRole.MEMBER,
        signatoryRole: membership.role === 'admin' ? 'primary' : null,
        joinedAt: membership.createdAt.toISOString(),
    };
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
const requireTransaction = async (groupId, transactionId) => {
    const transaction = await (0, transactionService_1.getTransaction)(groupId, transactionId);
    if (!transaction) {
        throw (0, http_1.createHttpError)(404, 'Transaction not found');
    }
    return transaction;
};
router.post('/deposits', async (req, res, next) => {
    try {
        const { groupId } = req.params;
        const user = await getCurrentUser(req.header('x-user-id'));
        await getGroupById(groupId);
        await requireMembership(groupId, user.id);
        const dto = parseDepositDto((0, http_1.getObjectBody)(req.body));
        const transaction = await (0, transactionService_1.createDeposit)(groupId, user.id, dto);
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
router.post('/withdrawals', async (req, res, next) => {
    try {
        const { groupId } = req.params;
        const user = await getCurrentUser(req.header('x-user-id'));
        await getGroupById(groupId);
        await requireMembership(groupId, user.id);
        const dto = parseWithdrawalDto((0, http_1.getObjectBody)(req.body));
        const transaction = await (0, transactionService_1.createWithdrawal)(groupId, user.id, dto);
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
router.get('/', async (req, res, next) => {
    try {
        const { groupId } = req.params;
        const user = await getCurrentUser(req.header('x-user-id'));
        await getGroupById(groupId);
        await requireMembership(groupId, user.id);
        const response = {
            data: {
                transactions: await (0, transactionService_1.listTransactions)(groupId),
            },
        };
        res.json(response);
    }
    catch (error) {
        next(error);
    }
});
router.get('/summary', async (req, res, next) => {
    try {
        const { groupId } = req.params;
        const user = await getCurrentUser(req.header('x-user-id'));
        await getGroupById(groupId);
        await requireMembership(groupId, user.id);
        const response = {
            data: await (0, transactionService_1.getTransactionsSummary)(groupId),
        };
        res.json(response);
    }
    catch (error) {
        next(error);
    }
});
router.get('/:transactionId', async (req, res, next) => {
    try {
        const { groupId, transactionId } = req.params;
        const user = await getCurrentUser(req.header('x-user-id'));
        await getGroupById(groupId);
        await requireMembership(groupId, user.id);
        const transaction = await requireTransaction(groupId, transactionId);
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
