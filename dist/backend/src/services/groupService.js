"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteGroup = exports.leaveGroup = exports.revokeMember = exports.promoteMember = exports.getTransactionsSummary = exports.approveWithdrawal = exports.createWithdrawal = exports.createDeposit = exports.processMpesaWebhookPayment = exports.getSignatoryReport = exports.joinGroup = exports.updateGroup = exports.getSpaceMembers = exports.leaveSpace = exports.joinSpace = exports.createSpace = exports.createGroup = exports.finalizeWebhookLog = exports.storeWebhookPayload = exports.getCompletedBalanceForSpace = exports.getCompletedBalancesBySpaceIds = void 0;
const contracts_1 = require("../../../shared/contracts");
const store_1 = require("../data/store");
const http_1 = require("../utils/http");
const prisma_1 = require("../lib/prisma");
const auth_1 = require("../utils/auth");
const MAX_SIGNATORIES = 3;
const JOINABLE_SIGNATORY_ROLES = [
    'primary',
    'secondary',
    'tertiary',
];
const PROMOTABLE_SIGNATORY_ROLES = ['secondary', 'tertiary'];
const withdrawals = [];
const getMpesaPaybillNumber = () => {
    return process.env.MPESA_PAYBILL?.trim() || '522522';
};
const isUniqueConstraintError = (error) => {
    return (typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'P2002');
};
const mapDbSpaceToGroup = (space) => {
    return {
        id: space.id,
        name: space.name,
        description: space.description ?? undefined,
        imageUrl: space.imageUrl ?? undefined,
        paybillNumber: space.paybillNumber ?? getMpesaPaybillNumber(),
        accountNumber: space.accountNumber ?? '',
        targetAmount: space.targetAmount ?? undefined,
        collectedAmount: 0,
        deadline: space.deadline?.toISOString(),
        createdByUserId: space.createdById,
        approvalThreshold: 1,
        createdAt: space.createdAt.toISOString(),
    };
};
const mapDbSpaceMemberToGroupMember = (member) => {
    const isAdmin = member.role === 'admin';
    return {
        id: member.id,
        groupId: member.spaceId,
        userId: member.userId,
        role: isAdmin ? contracts_1.GroupRole.SIGNATORY : contracts_1.GroupRole.MEMBER,
        signatoryRole: isAdmin ? 'primary' : null,
        joinedAt: member.createdAt.toISOString(),
    };
};
const mapDbSpaceMemberToSpaceMember = (member) => {
    return {
        ...mapDbSpaceMemberToGroupMember(member),
        name: member.user?.name ?? member.userId,
    };
};
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
const getCompletedBalancesBySpaceIds = async (spaceIds) => {
    const uniqueSpaceIds = Array.from(new Set(spaceIds.filter(Boolean)));
    if (uniqueSpaceIds.length === 0) {
        return new Map();
    }
    const groupedTransactions = await prisma_1.prisma.transaction.groupBy({
        by: ['spaceId', 'type'],
        where: {
            spaceId: {
                in: uniqueSpaceIds,
            },
            status: contracts_1.TransactionStatus.COMPLETED,
        },
        _sum: {
            amount: true,
        },
    });
    return groupedTransactions.reduce((balanceMap, item) => {
        const currentBalance = balanceMap.get(item.spaceId) ?? 0;
        const amount = Number(item._sum.amount ?? 0);
        const nextBalance = item.type === contracts_1.TransactionType.WITHDRAWAL
            ? currentBalance - amount
            : currentBalance + amount;
        balanceMap.set(item.spaceId, nextBalance);
        return balanceMap;
    }, new Map());
};
exports.getCompletedBalancesBySpaceIds = getCompletedBalancesBySpaceIds;
const getCompletedBalanceForSpace = async (spaceId) => {
    const balancesBySpaceId = await (0, exports.getCompletedBalancesBySpaceIds)([spaceId]);
    return balancesBySpaceId.get(spaceId) ?? 0;
};
exports.getCompletedBalanceForSpace = getCompletedBalanceForSpace;
const storeWebhookPayload = async (payload) => {
    const referenceValue = payload.receiptCode;
    const reference = typeof referenceValue === 'string' && referenceValue.trim().length > 0
        ? referenceValue.trim()
        : null;
    const event = await prisma_1.prisma.webhookEvent.create({
        data: {
            provider: 'mpesa',
            eventType: 'payment_confirmation',
            reference,
            status: 'received',
            payload: payload,
        },
    });
    return event.id;
};
exports.storeWebhookPayload = storeWebhookPayload;
const finalizeWebhookLog = async (logId, result, metadata) => {
    await prisma_1.prisma.webhookEvent.update({
        where: {
            id: logId,
        },
        data: {
            processedAt: new Date(),
            status: metadata?.status ?? result,
            reference: metadata?.reference ?? undefined,
            spaceId: metadata?.spaceId ?? undefined,
            errorMessage: metadata?.errorMessage ?? undefined,
        },
    });
};
exports.finalizeWebhookLog = finalizeWebhookLog;
const normalizePhoneNumber = (value) => {
    const digitsOnly = value.replace(/[^\d]/g, '');
    if (digitsOnly.startsWith('254')) {
        return digitsOnly;
    }
    if (digitsOnly.startsWith('0')) {
        return `254${digitsOnly.slice(1)}`;
    }
    return digitsOnly;
};
const generateAccountNumber = () => {
    let accountNumber = '';
    do {
        accountNumber = `AKB_${Date.now().toString(36).toUpperCase()}_${Math.random()
            .toString(36)
            .slice(2, 6)
            .toUpperCase()}`;
    } while (store_1.groups.some((group) => group.accountNumber === accountNumber));
    return accountNumber;
};
const getGroupOrThrow = (groupId) => {
    const group = store_1.groups.find((item) => item.id === groupId);
    if (!group) {
        throw (0, http_1.createHttpError)(404, 'Group not found');
    }
    return group;
};
const getMemberOrThrow = (groupId, memberId) => {
    const member = store_1.groupMembers.find((item) => item.groupId === groupId && item.id === memberId);
    if (!member) {
        throw (0, http_1.createHttpError)(404, 'Group member not found');
    }
    return member;
};
const getMemberByUserId = (groupId, userId) => {
    return store_1.groupMembers.find((item) => item.groupId === groupId && item.userId === userId);
};
const requireRequesterMembership = (groupId, userId) => {
    const membership = getMemberByUserId(groupId, userId);
    if (!membership) {
        throw (0, http_1.createHttpError)(403, 'You are not a member of this group');
    }
    return membership;
};
const requireCreatorAccess = (group, userId) => {
    if (group.createdByUserId !== userId) {
        throw (0, http_1.createHttpError)(403, 'Only the account creator can manage signatories');
    }
};
const getSignatoriesForGroup = (groupId) => {
    return store_1.groupMembers.filter((item) => item.groupId === groupId && item.signatoryRole !== null);
};
const getAssignedRoles = (groupId) => {
    return getSignatoriesForGroup(groupId)
        .map((item) => item.signatoryRole)
        .filter((role) => role !== null);
};
const countSignatories = (groupId) => {
    return getSignatoriesForGroup(groupId).length;
};
const getNextAvailableRole = (groupId, candidates) => {
    const assignedRoles = getAssignedRoles(groupId);
    for (const role of candidates) {
        if (!assignedRoles.includes(role)) {
            return role;
        }
    }
    return null;
};
const clampApprovalThreshold = (group) => {
    const signatoryCount = countSignatories(group.id);
    if (group.approvalThreshold > signatoryCount) {
        group.approvalThreshold = signatoryCount;
    }
};
const removeById = (items, id) => {
    const index = items.findIndex((item) => item.id === id);
    if (index >= 0) {
        items.splice(index, 1);
    }
};
const hasPendingApprovalRisk = (groupId, userId) => {
    return store_1.transactions.some((transaction) => {
        if (transaction.groupId !== groupId || transaction.status !== contracts_1.TransactionStatus.PENDING_APPROVAL) {
            return false;
        }
        if (transaction.initiatedByUserId === userId) {
            return true;
        }
        return store_1.approvals.some((approval) => approval.transactionId === transaction.id && approval.signatoryUserId === userId);
    });
};
const isAdminForGroup = (groupId, userId) => {
    const membership = getMemberByUserId(groupId, userId);
    if (!membership) {
        return false;
    }
    return membership.role === contracts_1.GroupRole.SIGNATORY || membership.signatoryRole !== null;
};
const aggregateByDate = (entries) => {
    const totalsByDate = {};
    entries.forEach((entry) => {
        const date = new Date(entry.createdAt).toISOString().split('T')[0];
        totalsByDate[date] = (totalsByDate[date] || 0) + entry.amount;
    });
    return Object.keys(totalsByDate)
        .sort()
        .map((date) => ({
        date,
        amount: totalsByDate[date],
    }));
};
const createGroup = (userId, dto) => {
    if (dto.approvalThreshold > MAX_SIGNATORIES) {
        throw (0, http_1.createHttpError)(400, 'approvalThreshold cannot exceed the maximum signatories (3)');
    }
    const group = {
        id: (0, http_1.createId)('group'),
        name: dto.name,
        description: dto.description,
        imageUrl: dto.image,
        paybillNumber: getMpesaPaybillNumber(),
        accountNumber: generateAccountNumber(),
        targetAmount: dto.targetAmount,
        collectedAmount: dto.targetAmount ? 0 : undefined,
        deadline: dto.deadline,
        createdByUserId: userId,
        approvalThreshold: dto.approvalThreshold,
        createdAt: new Date().toISOString(),
    };
    const member = {
        id: (0, http_1.createId)('member'),
        groupId: group.id,
        userId,
        role: contracts_1.GroupRole.SIGNATORY,
        signatoryRole: 'primary',
        joinedAt: new Date().toISOString(),
    };
    store_1.groups.push(group);
    store_1.groupMembers.push(member);
    return { group, member };
};
exports.createGroup = createGroup;
const createSpace = async (input) => {
    const accountNumber = `AKB_${Date.now()}`;
    try {
        const space = await prisma_1.prisma.$transaction(async (tx) => {
            const createdSpace = await tx.space.create({
                data: {
                    name: input.name,
                    description: input.description,
                    imageUrl: input.imageUrl,
                    targetAmount: input.targetAmount,
                    deadline: input.deadline ? new Date(input.deadline) : undefined,
                    paybillNumber: getMpesaPaybillNumber(),
                    accountNumber,
                    createdById: input.createdById,
                },
            });
            await tx.spaceMember.create({
                data: {
                    spaceId: createdSpace.id,
                    userId: input.createdById,
                    role: 'admin',
                },
            });
            return createdSpace;
        });
        return {
            space: {
                id: space.id,
                name: space.name,
                description: space.description ?? undefined,
                imageUrl: space.imageUrl ?? undefined,
                paybillNumber: space.paybillNumber ?? getMpesaPaybillNumber(),
                accountNumber: space.accountNumber ?? accountNumber,
                targetAmount: space.targetAmount ?? undefined,
                collectedAmount: 0,
                deadline: space.deadline ? space.deadline.toISOString() : undefined,
                createdByUserId: space.createdById,
                approvalThreshold: 1,
                createdAt: space.createdAt.toISOString(),
            },
        };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        throw (0, http_1.createHttpError)(500, `Failed to create space: ${message}`);
    }
};
exports.createSpace = createSpace;
const joinSpace = async (spaceId, userId) => {
    const space = await prisma_1.prisma.space.findUnique({
        where: {
            id: spaceId,
        },
    });
    if (!space) {
        throw (0, http_1.createHttpError)(404, 'Group not found');
    }
    const existingMembership = await prisma_1.prisma.spaceMember.findFirst({
        where: {
            spaceId,
            userId,
        },
    });
    if (existingMembership) {
        throw (0, http_1.createHttpError)(409, 'User is already a member of this group');
    }
    let membership;
    try {
        membership = await prisma_1.prisma.spaceMember.create({
            data: {
                spaceId,
                userId,
                role: 'member',
            },
        });
    }
    catch (error) {
        if (isUniqueConstraintError(error)) {
            throw (0, http_1.createHttpError)(409, 'User is already a member of this group');
        }
        throw error;
    }
    return mapDbSpaceMemberToGroupMember(membership);
};
exports.joinSpace = joinSpace;
const leaveSpace = async (spaceId, userId) => {
    const membership = await prisma_1.prisma.spaceMember.findFirst({
        where: {
            spaceId,
            userId,
        },
        include: {
            space: true,
        },
    });
    if (!membership) {
        throw (0, http_1.createHttpError)(404, 'Group member not found');
    }
    if (!membership.space) {
        throw (0, http_1.createHttpError)(404, 'Group not found');
    }
    if (membership.space.createdById === userId) {
        throw (0, http_1.createHttpError)(409, 'Creator cannot leave group');
    }
    if (membership.role === 'admin') {
        const adminCount = await prisma_1.prisma.spaceMember.count({
            where: {
                spaceId,
                role: 'admin',
            },
        });
        if (adminCount <= 1) {
            throw (0, http_1.createHttpError)(409, 'At least one admin must remain in the group');
        }
        throw (0, http_1.createHttpError)(409, 'Admins must be demoted before leaving the space');
    }
    await prisma_1.prisma.spaceMember.delete({
        where: {
            id: membership.id,
        },
    });
    return mapDbSpaceMemberToGroupMember(membership);
};
exports.leaveSpace = leaveSpace;
const getSpaceMembers = async (spaceId) => {
    const space = await prisma_1.prisma.space.findUnique({
        where: {
            id: spaceId,
        },
    });
    if (!space) {
        throw (0, http_1.createHttpError)(404, 'Group not found');
    }
    const members = await prisma_1.prisma.spaceMember.findMany({
        where: {
            spaceId,
        },
        include: {
            user: true,
        },
        orderBy: [
            {
                role: 'asc',
            },
            {
                createdAt: 'asc',
            },
        ],
    });
    return members.map(mapDbSpaceMemberToSpaceMember);
};
exports.getSpaceMembers = getSpaceMembers;
const updateGroup = (groupId, actorUserId, dto) => {
    const group = getGroupOrThrow(groupId);
    requireRequesterMembership(groupId, actorUserId);
    requireCreatorAccess(group, actorUserId);
    if (dto.name !== undefined) {
        group.name = dto.name;
    }
    if (Object.prototype.hasOwnProperty.call(dto, 'description')) {
        group.description = dto.description;
    }
    if (dto.imageUrl !== undefined) {
        group.imageUrl = dto.imageUrl;
    }
    if (dto.approvalThreshold !== undefined) {
        if (dto.approvalThreshold > MAX_SIGNATORIES) {
            throw (0, http_1.createHttpError)(400, 'approvalThreshold cannot exceed the maximum signatories (3)');
        }
        group.approvalThreshold = dto.approvalThreshold;
        clampApprovalThreshold(group);
    }
    if (dto.targetAmount !== undefined) {
        group.targetAmount = dto.targetAmount;
        group.collectedAmount = dto.targetAmount > 0 ? group.collectedAmount ?? 0 : undefined;
    }
    if (Object.prototype.hasOwnProperty.call(dto, 'deadline')) {
        group.deadline = dto.deadline;
    }
    return group;
};
exports.updateGroup = updateGroup;
const joinGroup = (groupId, userId) => {
    const nextSignatoryRole = getNextAvailableRole(groupId, JOINABLE_SIGNATORY_ROLES);
    const member = {
        id: (0, http_1.createId)('member'),
        groupId,
        userId,
        role: nextSignatoryRole === null ? contracts_1.GroupRole.MEMBER : contracts_1.GroupRole.SIGNATORY,
        signatoryRole: nextSignatoryRole,
        joinedAt: new Date().toISOString(),
    };
    store_1.groupMembers.push(member);
    return member;
};
exports.joinGroup = joinGroup;
const getSignatoryReport = async (groupId, requesterUserId) => {
    getGroupOrThrow(groupId);
    requireRequesterMembership(groupId, requesterUserId);
    const signatoryMembers = getSignatoriesForGroup(groupId);
    const usersById = await (0, auth_1.getUsersByIds)(signatoryMembers.map((member) => member.userId));
    const signatories = signatoryMembers
        .map((member) => {
        const user = usersById.get(member.userId);
        if (!user || member.signatoryRole === null) {
            return null;
        }
        return {
            userId: member.userId,
            name: user.name,
            signatoryRole: member.signatoryRole,
        };
    })
        .filter((item) => item !== null);
    return {
        signatories,
        remainingSlots: MAX_SIGNATORIES - signatories.length,
    };
};
exports.getSignatoryReport = getSignatoryReport;
const processMpesaWebhookPayment = async (amount, accountNumber, phoneNumber, receiptCode, externalName) => {
    const space = await prisma_1.prisma.space.findUnique({
        where: {
            accountNumber,
        },
    });
    if (!space) {
        throw (0, http_1.createHttpError)(404, 'Space not found for this account number');
    }
    const normalizedPhoneNumber = normalizePhoneNumber(phoneNumber);
    const existingTransaction = await prisma_1.prisma.transaction.findUnique({
        where: {
            reference: receiptCode,
        },
    });
    if (existingTransaction) {
        if (existingTransaction.status === contracts_1.TransactionStatus.COMPLETED) {
            return {
                deposit: mapDbTransactionToContractTransaction(existingTransaction),
                duplicate: true,
                group: mapDbSpaceToGroup(space),
            };
        }
        const completedTransaction = await prisma_1.prisma.transaction.update({
            where: {
                id: existingTransaction.id,
            },
            data: {
                amount,
                status: contracts_1.TransactionStatus.COMPLETED,
                source: contracts_1.TransactionSource.MPESA_PAYBILL,
                phoneNumber: normalizedPhoneNumber,
                externalName,
            },
        });
        return {
            deposit: mapDbTransactionToContractTransaction(completedTransaction),
            duplicate: false,
            group: mapDbSpaceToGroup(space),
        };
    }
    try {
        const createdTransaction = await prisma_1.prisma.transaction.create({
            data: {
                spaceId: space.id,
                userId: null,
                type: contracts_1.TransactionType.DEPOSIT,
                status: contracts_1.TransactionStatus.COMPLETED,
                amount,
                reference: receiptCode,
                source: contracts_1.TransactionSource.MPESA_PAYBILL,
                phoneNumber: normalizedPhoneNumber,
                externalName,
            },
        });
        return {
            deposit: mapDbTransactionToContractTransaction(createdTransaction),
            duplicate: false,
            group: mapDbSpaceToGroup(space),
        };
    }
    catch (error) {
        if (isUniqueConstraintError(error)) {
            const duplicateTransaction = await prisma_1.prisma.transaction.findUnique({
                where: {
                    reference: receiptCode,
                },
            });
            if (!duplicateTransaction) {
                throw error;
            }
            return {
                deposit: mapDbTransactionToContractTransaction(duplicateTransaction),
                duplicate: duplicateTransaction.status === contracts_1.TransactionStatus.COMPLETED,
                group: mapDbSpaceToGroup(space),
            };
        }
        throw error;
    }
};
exports.processMpesaWebhookPayment = processMpesaWebhookPayment;
const createDeposit = async (spaceId, userId, amount, options) => {
    if (amount <= 0) {
        throw (0, http_1.createHttpError)(400, 'amount must be a positive number');
    }
    const space = await prisma_1.prisma.space.findUnique({
        where: {
            id: spaceId,
        },
    });
    if (!space) {
        throw (0, http_1.createHttpError)(404, 'Group not found');
    }
    const reference = options?.reference?.trim() || (0, http_1.createId)('deposit_ref');
    const transactionStatus = userId ? contracts_1.TransactionStatus.INITIATED : contracts_1.TransactionStatus.PENDING;
    try {
        const transaction = await prisma_1.prisma.transaction.create({
            data: {
                spaceId,
                userId,
                type: contracts_1.TransactionType.DEPOSIT,
                status: transactionStatus,
                amount,
                reference,
                source: options?.source ?? contracts_1.TransactionSource.MPESA_STK,
                phoneNumber: options?.phoneNumber,
                externalName: options?.externalName,
            },
        });
        return mapDbTransactionToContractTransaction(transaction);
    }
    catch (error) {
        if (isUniqueConstraintError(error)) {
            throw (0, http_1.createHttpError)(409, 'A deposit with this reference already exists');
        }
        throw error;
    }
};
exports.createDeposit = createDeposit;
const createWithdrawal = async (spaceId, userId, amount, reason) => {
    if (amount <= 0) {
        throw (0, http_1.createHttpError)(400, 'amount must be a positive number');
    }
    const group = getGroupOrThrow(spaceId);
    const currentBalance = group.collectedAmount ?? 0;
    if (currentBalance < amount) {
        throw (0, http_1.createHttpError)(409, 'Insufficient funds in this space');
    }
    const withdrawal = {
        id: `wd_${Date.now()}`,
        spaceId,
        requestedByUserId: userId,
        amount,
        reason,
        status: 'pending',
        approvals: [],
        requiredApprovals: group.approvalThreshold ?? 1,
        createdAt: new Date().toISOString(),
    };
    withdrawals.push(withdrawal);
    return withdrawal;
};
exports.createWithdrawal = createWithdrawal;
const approveWithdrawal = async (withdrawalId, userId) => {
    const withdrawal = withdrawals.find((item) => item.id === withdrawalId);
    if (!withdrawal) {
        throw (0, http_1.createHttpError)(404, 'Withdrawal not found');
    }
    if (withdrawal.status !== 'pending') {
        throw (0, http_1.createHttpError)(409, 'Withdrawal is no longer pending');
    }
    if (!isAdminForGroup(withdrawal.spaceId, userId)) {
        throw (0, http_1.createHttpError)(403, 'Only admins can approve withdrawals');
    }
    if (withdrawal.approvals.includes(userId)) {
        throw (0, http_1.createHttpError)(409, 'You have already approved this withdrawal');
    }
    withdrawal.approvals.push(userId);
    if (withdrawal.approvals.length >= withdrawal.requiredApprovals) {
        withdrawal.status = 'approved';
        setTimeout(() => {
            if (withdrawal.status !== 'approved') {
                return;
            }
            const group = getGroupOrThrow(withdrawal.spaceId);
            const currentBalance = group.collectedAmount ?? 0;
            if (currentBalance < withdrawal.amount) {
                withdrawal.status = 'failed';
                return;
            }
            group.collectedAmount = currentBalance - withdrawal.amount;
            withdrawal.status = 'completed';
        }, 2500);
    }
    return withdrawal;
};
exports.approveWithdrawal = approveWithdrawal;
const getTransactionsSummary = async (spaceId) => {
    const space = await prisma_1.prisma.space.findUnique({
        where: {
            id: spaceId,
        },
    });
    if (!space) {
        throw (0, http_1.createHttpError)(404, 'Group not found');
    }
    const [completedTransactions, pendingDepositTransactions] = await Promise.all([
        prisma_1.prisma.transaction.findMany({
            where: {
                spaceId,
                status: contracts_1.TransactionStatus.COMPLETED,
            },
            orderBy: {
                createdAt: 'asc',
            },
        }),
        prisma_1.prisma.transaction.findMany({
            where: {
                spaceId,
                type: contracts_1.TransactionType.DEPOSIT,
                status: {
                    in: [contracts_1.TransactionStatus.INITIATED, contracts_1.TransactionStatus.PENDING],
                },
            },
            include: {
                user: true,
            },
            orderBy: {
                createdAt: 'desc',
            },
        }),
    ]);
    const completedDeposits = completedTransactions.filter((transaction) => transaction.type === contracts_1.TransactionType.DEPOSIT);
    const completedWithdrawals = completedTransactions.filter((transaction) => transaction.type === contracts_1.TransactionType.WITHDRAWAL);
    const pendingWithdrawals = withdrawals
        .filter((withdrawal) => withdrawal.spaceId === spaceId &&
        (withdrawal.status === 'pending' || withdrawal.status === 'approved'));
    const pendingUserIds = [
        ...pendingWithdrawals.map((withdrawal) => withdrawal.requestedByUserId),
    ];
    const usersById = await (0, auth_1.getUsersByIds)(pendingUserIds);
    const pendingDepositsSummary = pendingDepositTransactions.map((deposit) => {
        const userName = deposit.user?.name ??
            deposit.externalName ??
            deposit.phoneNumber ??
            'External payer';
        const derivedUserId = deposit.userId ?? `external_${deposit.id}`;
        return {
            id: deposit.id,
            userId: derivedUserId,
            userName,
            amount: Number(deposit.amount),
            status: 'pending',
            createdAt: deposit.createdAt.toISOString(),
        };
    });
    const pendingWithdrawalsSummary = pendingWithdrawals.map((withdrawal) => {
        const user = usersById.get(withdrawal.requestedByUserId);
        return {
            id: withdrawal.id,
            requestedByUserId: withdrawal.requestedByUserId,
            requestedByName: user?.name ?? withdrawal.requestedByUserId,
            amount: withdrawal.amount,
            reason: withdrawal.reason,
            approvals: withdrawal.approvals,
            requiredApprovals: withdrawal.requiredApprovals,
            status: withdrawal.status,
            createdAt: withdrawal.createdAt,
        };
    });
    const totalDeposits = completedDeposits.reduce((sum, deposit) => sum + Number(deposit.amount), 0);
    const totalWithdrawals = completedWithdrawals.reduce((sum, withdrawal) => sum + Number(withdrawal.amount), 0);
    const depositsOverTime = aggregateByDate(completedDeposits.map((deposit) => ({
        amount: Number(deposit.amount),
        createdAt: deposit.createdAt.toISOString(),
    })));
    const withdrawalsOverTime = aggregateByDate(completedWithdrawals.map((withdrawal) => ({
        amount: Number(withdrawal.amount),
        createdAt: withdrawal.createdAt.toISOString(),
    })));
    return {
        totalDeposits,
        totalWithdrawals,
        currentBalance: totalDeposits - totalWithdrawals,
        depositsOverTime,
        withdrawalsOverTime,
        pendingWithdrawals: pendingWithdrawalsSummary,
        pendingDeposits: pendingDepositsSummary,
        hasPendingTransactions: pendingDepositsSummary.length > 0 || pendingWithdrawalsSummary.length > 0,
    };
};
exports.getTransactionsSummary = getTransactionsSummary;
const promoteMember = (groupId, memberId, actorUserId) => {
    const group = getGroupOrThrow(groupId);
    requireRequesterMembership(groupId, actorUserId);
    requireCreatorAccess(group, actorUserId);
    const member = getMemberOrThrow(groupId, memberId);
    if (member.signatoryRole !== null || member.role === contracts_1.GroupRole.SIGNATORY) {
        throw (0, http_1.createHttpError)(409, 'Member is already a signatory');
    }
    if (countSignatories(groupId) >= MAX_SIGNATORIES) {
        throw (0, http_1.createHttpError)(409, 'This group already has the maximum number of signatories');
    }
    const nextRole = getNextAvailableRole(groupId, PROMOTABLE_SIGNATORY_ROLES);
    if (nextRole === null) {
        throw (0, http_1.createHttpError)(409, 'No signatory slot is available for promotion');
    }
    member.role = contracts_1.GroupRole.SIGNATORY;
    member.signatoryRole = nextRole;
    return member;
};
exports.promoteMember = promoteMember;
const revokeMember = (groupId, memberId, actorUserId) => {
    const group = getGroupOrThrow(groupId);
    requireRequesterMembership(groupId, actorUserId);
    requireCreatorAccess(group, actorUserId);
    const member = getMemberOrThrow(groupId, memberId);
    if (member.userId === group.createdByUserId || member.signatoryRole === 'primary') {
        throw (0, http_1.createHttpError)(409, 'The account creator cannot be revoked as a signatory');
    }
    if (member.signatoryRole === null || member.role !== contracts_1.GroupRole.SIGNATORY) {
        throw (0, http_1.createHttpError)(409, 'Only signatories can be revoked');
    }
    member.role = contracts_1.GroupRole.MEMBER;
    member.signatoryRole = null;
    clampApprovalThreshold(group);
    return member;
};
exports.revokeMember = revokeMember;
const leaveGroup = (groupId, memberId, requesterUserId) => {
    const group = getGroupOrThrow(groupId);
    const member = getMemberOrThrow(groupId, memberId);
    if (member.userId !== requesterUserId) {
        throw (0, http_1.createHttpError)(403, 'Users can only leave a group for themselves');
    }
    if (member.userId === group.createdByUserId || member.signatoryRole === 'primary') {
        throw (0, http_1.createHttpError)(409, 'Creator cannot leave group');
    }
    if (member.signatoryRole === 'secondary' || member.signatoryRole === 'tertiary') {
        throw (0, http_1.createHttpError)(409, 'Signatory must transfer role before leaving');
    }
    if (hasPendingApprovalRisk(groupId, requesterUserId)) {
        throw (0, http_1.createHttpError)(409, 'Cannot leave group with pending approvals on transactions');
    }
    removeById(store_1.groupMembers, member.id);
    return member;
};
exports.leaveGroup = leaveGroup;
const deleteGroup = (groupId, requesterUserId) => {
    const group = getGroupOrThrow(groupId);
    if (group.createdByUserId !== requesterUserId) {
        throw (0, http_1.createHttpError)(403, 'Only the creator can delete this group');
    }
    const groupTransactions = store_1.transactions.filter((item) => item.groupId === groupId);
    if (groupTransactions.some((item) => item.status === contracts_1.TransactionStatus.PENDING_APPROVAL)) {
        throw (0, http_1.createHttpError)(409, 'Cannot delete group with pending transactions');
    }
    if (groupTransactions.some((item) => item.status !== contracts_1.TransactionStatus.COMPLETED)) {
        throw (0, http_1.createHttpError)(409, 'Cannot delete group with active funds in system');
    }
    const groupTransactionIds = new Set(groupTransactions.map((item) => item.id));
    for (let index = store_1.approvals.length - 1; index >= 0; index -= 1) {
        if (groupTransactionIds.has(store_1.approvals[index].transactionId)) {
            store_1.approvals.splice(index, 1);
        }
    }
    for (let index = store_1.transactions.length - 1; index >= 0; index -= 1) {
        if (store_1.transactions[index].groupId === groupId) {
            store_1.transactions.splice(index, 1);
        }
    }
    for (let index = store_1.messages.length - 1; index >= 0; index -= 1) {
        if (store_1.messages[index].groupId === groupId) {
            store_1.messages.splice(index, 1);
        }
    }
    for (let index = store_1.groupMembers.length - 1; index >= 0; index -= 1) {
        if (store_1.groupMembers[index].groupId === groupId) {
            store_1.groupMembers.splice(index, 1);
        }
    }
    removeById(store_1.groups, group.id);
    return group.id;
};
exports.deleteGroup = deleteGroup;
