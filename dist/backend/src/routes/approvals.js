"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const contracts_1 = require("../../../shared/contracts");
const prisma_1 = require("../lib/prisma");
const http_1 = require("../utils/http");
const auth_1 = require("../utils/auth");
const transactionService_1 = require("../services/transactionService");
const groupService_1 = require("../services/groupService");
const approvalService_1 = require("../services/approvalService");
const router = (0, express_1.Router)({ mergeParams: true });
const getCurrentUser = async (headerValue) => {
    const userId = (0, http_1.ensureNonEmptyString)(headerValue, 'x-user-id header is required');
    return (0, auth_1.getCurrentUserOrThrow)(userId);
};
const getGroupById = async (groupId) => {
    const group = await prisma_1.prisma.space.findUnique({
        where: {
            id: groupId,
        },
    });
    if (!group) {
        throw (0, http_1.createHttpError)(404, 'Group not found');
    }
    return group;
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
    return membership;
};
const requireTransactionById = async (transactionId) => {
    const transaction = await prisma_1.prisma.transaction.findUnique({
        where: {
            id: transactionId,
        },
    });
    if (!transaction) {
        throw (0, http_1.createHttpError)(404, 'Transaction not found');
    }
    return {
        id: transaction.id,
        spaceId: transaction.spaceId,
        userId: transaction.userId ?? undefined,
        type: transaction.type,
        amount: Number(transaction.amount),
        reference: transaction.reference,
        source: transaction.source,
        phoneNumber: transaction.phoneNumber ?? undefined,
        externalName: transaction.externalName ?? undefined,
        recipientPhoneNumber: transaction.recipientPhoneNumber ?? undefined,
        recipientName: transaction.recipientName ?? undefined,
        status: transaction.status,
        createdAt: transaction.createdAt.toISOString(),
        groupId: transaction.spaceId,
        initiatedByUserId: transaction.userId ?? undefined,
        description: transaction.description ?? undefined,
        destination: transaction.destination ?? undefined,
    };
};
const requireTransactionInGroup = async (groupId, transactionId) => {
    const transaction = await (0, transactionService_1.getTransaction)(groupId, transactionId);
    if (!transaction) {
        throw (0, http_1.createHttpError)(404, 'Transaction not found');
    }
    return transaction;
};
router.get('/', async (req, res, next) => {
    try {
        const { groupId, transactionId } = req.params;
        const user = await getCurrentUser(req.header('x-user-id'));
        await getGroupById(groupId);
        await requireMembership(groupId, user.id);
        const transaction = await requireTransactionById(transactionId);
        if (transaction.groupId !== groupId) {
            throw (0, http_1.createHttpError)(400, 'groupId does not match the transaction group');
        }
        const response = {
            data: {
                approvals: await (0, approvalService_1.listApprovals)(transactionId),
            },
        };
        res.json(response);
    }
    catch (error) {
        next(error);
    }
});
router.post('/', async (req, res, next) => {
    try {
        const { groupId, transactionId } = req.params;
        const user = await getCurrentUser(req.header('x-user-id'));
        const group = await getGroupById(groupId);
        await requireMembership(groupId, user.id);
        const transaction = await requireTransactionById(transactionId);
        if (transaction.groupId !== group.id) {
            throw (0, http_1.createHttpError)(400, 'groupId does not match the transaction group');
        }
        if (transaction.type !== contracts_1.TransactionType.WITHDRAWAL) {
            throw (0, http_1.createHttpError)(400, 'Only withdrawals can be approved');
        }
        const body = (0, http_1.getObjectBody)(req.body);
        const dto = {
            status: (0, http_1.ensureEnumValue)(body.status, [contracts_1.ApprovalStatus.APPROVED, contracts_1.ApprovalStatus.REJECTED], 'status must be approved or rejected'),
        };
        if (dto.status === contracts_1.ApprovalStatus.APPROVED) {
            await (0, groupService_1.approveWithdrawal)(transaction.id, user.id);
        }
        else {
            await (0, groupService_1.rejectWithdrawal)(transaction.id, user.id);
        }
        const approval = await (0, approvalService_1.getApprovalByTransactionAndAdmin)(transaction.id, user.id);
        if (!approval) {
            throw (0, http_1.createHttpError)(500, 'Approval could not be recorded');
        }
        const updatedTransaction = await requireTransactionInGroup(groupId, transactionId);
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
