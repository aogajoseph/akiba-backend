"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteGroup = exports.leaveGroup = exports.revokeMember = exports.promoteMember = exports.getTransactionsSummary = exports.listWithdrawalApprovals = exports.executeWithdrawal = exports.rejectWithdrawal = exports.approveWithdrawal = exports.createWithdrawal = exports.createDeposit = exports.processMpesaWebhookPayment = exports.getSignatoryReport = exports.joinGroup = exports.updateGroup = exports.getSpaceMembers = exports.leaveSpace = exports.joinSpace = exports.createSpace = exports.createGroup = exports.finalizeWebhookLog = exports.storeWebhookPayload = exports.getCompletedBalanceForSpace = exports.getSpaceSummary = exports.getSpaceFinancialSnapshotBySpaceIds = exports.getCompletedBalancesBySpaceIds = exports.getAvailableBalanceForSpace = void 0;
const contracts_1 = require("../../../shared/contracts");
const phone_1 = require("../../../shared/phone");
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
const SERVICE_FEE_RATE = 0.025;
const getMpesaPaybillNumber = () => {
    return process.env.MPESA_PAYBILL?.trim() || '522522';
};
const ensureApprovalThresholdInRange = (approvalThreshold) => {
    if (approvalThreshold < 2 || approvalThreshold > 3) {
        throw (0, http_1.createHttpError)(400, 'approvalThreshold must be between 2 and 3');
    }
};
const isUniqueConstraintError = (error) => {
    return (typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'P2002');
};
const mapDbSpaceToGroup = (space, collectedAmount = 0) => {
    return {
        id: space.id,
        name: space.name,
        description: space.description ?? undefined,
        imageUrl: space.imageUrl ?? undefined,
        paybillNumber: space.paybillNumber ?? getMpesaPaybillNumber(),
        accountNumber: space.accountNumber ?? '',
        targetAmount: space.targetAmount ?? undefined,
        collectedAmount,
        deadline: space.deadline?.toISOString(),
        createdByUserId: space.createdById,
        approvalThreshold: space.approvalThreshold,
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
        recipientPhoneNumber: transaction.recipientPhoneNumber ?? undefined,
        recipientName: transaction.recipientName ?? undefined,
        status: transaction.status,
        createdAt: transaction.createdAt.toISOString(),
        currency: 'KES',
        description: transaction.description ?? undefined,
        reason: transaction.description ?? undefined,
        destination: transaction.destination ?? undefined,
    };
};
const mapDbWithdrawalApprovalToContractApproval = (approval) => {
    return {
        id: approval.id,
        transactionId: approval.transactionId,
        signatoryUserId: approval.adminId,
        status: approval.status,
        createdAt: approval.createdAt.toISOString(),
    };
};
const roundCurrency = (value) => {
    return Math.round((value + Number.EPSILON) * 100) / 100;
};
const calculateServiceFee = (amount) => {
    return Number((amount * SERVICE_FEE_RATE).toFixed(2));
};
const calculateWithdrawalFee = (amount) => {
    return roundCurrency(amount * SERVICE_FEE_RATE);
};
const getSpaceApprovalThreshold = (space) => {
    return Math.max(space.approvalThreshold ?? 2, 2);
};
const requireSpaceCreator = (space, userId) => {
    if (space.createdById !== userId) {
        throw (0, http_1.createHttpError)(403, 'Only the account creator can manage signatories');
    }
};
const getSpaceOrThrow = async (spaceId) => {
    const space = await prisma_1.prisma.space.findUnique({
        where: {
            id: spaceId,
        },
    });
    if (!space) {
        throw (0, http_1.createHttpError)(404, 'Group not found');
    }
    return space;
};
const getSpaceMembershipOrThrow = async (spaceId, userId) => {
    const membership = await prisma_1.prisma.spaceMember.findFirst({
        where: {
            spaceId,
            userId,
        },
    });
    if (!membership) {
        throw (0, http_1.createHttpError)(403, 'You are not a member of this group');
    }
    return membership;
};
const requireSpaceAdmin = async (spaceId, userId) => {
    const membership = await prisma_1.prisma.spaceMember.findFirst({
        where: {
            spaceId,
            userId,
        },
    });
    if (!membership) {
        throw (0, http_1.createHttpError)(403, 'You are not a member of this group');
    }
    if (membership.role !== 'admin') {
        throw (0, http_1.createHttpError)(403, 'Only admins can approve or reject withdrawals');
    }
    return membership;
};
const getAvailableBalanceForSpace = async (spaceId) => {
    const snapshots = await (0, exports.getSpaceFinancialSnapshotBySpaceIds)([spaceId]);
    return snapshots.get(spaceId)?.availableBalance ?? 0;
};
exports.getAvailableBalanceForSpace = getAvailableBalanceForSpace;
const getCompletedBalancesBySpaceIds = async (spaceIds) => {
    const snapshots = await (0, exports.getSpaceFinancialSnapshotBySpaceIds)(spaceIds);
    return new Map(Array.from(snapshots.entries()).map(([spaceId, snapshot]) => [
        spaceId,
        snapshot.availableBalance,
    ]));
};
exports.getCompletedBalancesBySpaceIds = getCompletedBalancesBySpaceIds;
const getSpaceFinancialSnapshotBySpaceIds = async (spaceIds) => {
    const uniqueSpaceIds = Array.from(new Set(spaceIds.filter(Boolean)));
    if (uniqueSpaceIds.length === 0) {
        return new Map();
    }
    const [completedDeposits, pendingWithdrawals, completedWithdrawals] = await Promise.all([
        prisma_1.prisma.transaction.groupBy({
            by: ['spaceId'],
            where: {
                spaceId: {
                    in: uniqueSpaceIds,
                },
                type: contracts_1.TransactionType.DEPOSIT,
                status: contracts_1.TransactionStatus.COMPLETED,
            },
            _sum: {
                amount: true,
            },
        }),
        prisma_1.prisma.transaction.groupBy({
            by: ['spaceId'],
            where: {
                spaceId: {
                    in: uniqueSpaceIds,
                },
                type: contracts_1.TransactionType.WITHDRAWAL,
                status: {
                    in: [contracts_1.TransactionStatus.PENDING_APPROVAL, contracts_1.TransactionStatus.APPROVED],
                },
            },
            _sum: {
                amount: true,
            },
        }),
        prisma_1.prisma.transaction.groupBy({
            by: ['spaceId'],
            where: {
                spaceId: {
                    in: uniqueSpaceIds,
                },
                type: contracts_1.TransactionType.WITHDRAWAL,
                status: contracts_1.TransactionStatus.COMPLETED,
            },
            _sum: {
                amount: true,
            },
        }),
    ]);
    const depositsBySpaceId = new Map(completedDeposits.map((item) => [item.spaceId, Number(item._sum.amount ?? 0)]));
    const pendingWithdrawalsBySpaceId = new Map(pendingWithdrawals.map((item) => [item.spaceId, Number(item._sum.amount ?? 0)]));
    const completedWithdrawalsBySpaceId = new Map(completedWithdrawals.map((item) => [item.spaceId, Number(item._sum.amount ?? 0)]));
    return uniqueSpaceIds.reduce((snapshotMap, spaceId) => {
        const totalBalance = depositsBySpaceId.get(spaceId) ?? 0;
        const pendingWithdrawalAmount = pendingWithdrawalsBySpaceId.get(spaceId) ?? 0;
        const completedWithdrawalAmount = completedWithdrawalsBySpaceId.get(spaceId) ?? 0;
        const effectiveDeposits = roundCurrency(totalBalance - completedWithdrawalAmount - pendingWithdrawalAmount);
        const totalFees = calculateServiceFee(effectiveDeposits);
        const reservedAmount = roundCurrency(pendingWithdrawalAmount + completedWithdrawalAmount);
        const availableBalance = roundCurrency(effectiveDeposits - totalFees);
        snapshotMap.set(spaceId, {
            totalBalance,
            totalFees,
            pendingWithdrawalAmount,
            reservedAmount,
            availableBalance,
        });
        return snapshotMap;
    }, new Map());
};
exports.getSpaceFinancialSnapshotBySpaceIds = getSpaceFinancialSnapshotBySpaceIds;
const buildCreatedAtFilter = (filters) => {
    if (!filters?.from && !filters?.to) {
        return undefined;
    }
    return {
        gte: filters?.from,
        lte: filters?.to,
    };
};
const getSpaceSummary = async (spaceId, filters) => {
    await getSpaceOrThrow(spaceId);
    const createdAt = buildCreatedAtFilter(filters);
    const where = {
        spaceId,
        createdAt,
    };
    const [completedDeposits, completedWithdrawals, pendingWithdrawals, transactions,] = await Promise.all([
        prisma_1.prisma.transaction.aggregate({
            where: {
                ...where,
                type: contracts_1.TransactionType.DEPOSIT,
                status: contracts_1.TransactionStatus.COMPLETED,
            },
            _sum: {
                amount: true,
            },
        }),
        prisma_1.prisma.transaction.aggregate({
            where: {
                ...where,
                type: contracts_1.TransactionType.WITHDRAWAL,
                status: contracts_1.TransactionStatus.COMPLETED,
            },
            _sum: {
                amount: true,
            },
        }),
        prisma_1.prisma.transaction.aggregate({
            where: {
                ...where,
                type: contracts_1.TransactionType.WITHDRAWAL,
                status: {
                    in: [contracts_1.TransactionStatus.PENDING_APPROVAL, contracts_1.TransactionStatus.APPROVED],
                },
            },
            _sum: {
                amount: true,
            },
        }),
        prisma_1.prisma.transaction.findMany({
            where,
            orderBy: {
                createdAt: 'desc',
            },
        }),
    ]);
    const totalDeposits = Number(completedDeposits._sum.amount ?? 0);
    const totalWithdrawals = Number(completedWithdrawals._sum.amount ?? 0);
    const pendingWithdrawalAmount = Number(pendingWithdrawals._sum.amount ?? 0);
    const effectiveDeposits = roundCurrency(totalDeposits - totalWithdrawals - pendingWithdrawalAmount);
    const totalFees = calculateServiceFee(effectiveDeposits);
    return {
        summary: {
            totalDeposits,
            totalWithdrawals,
            totalFees,
            netBalance: roundCurrency(effectiveDeposits - totalFees),
        },
        transactions: transactions.map(mapDbTransactionToContractTransaction),
    };
};
exports.getSpaceSummary = getSpaceSummary;
const getCompletedBalanceForSpace = async (spaceId) => {
    const balancesBySpaceId = await (0, exports.getCompletedBalancesBySpaceIds)([spaceId]);
    return balancesBySpaceId.get(spaceId) ?? 0;
};
exports.getCompletedBalanceForSpace = getCompletedBalanceForSpace;
const storeWebhookPayload = async (payload) => {
    const referenceValue = payload.reference ??
        payload.receiptCode ??
        payload.TransID ??
        payload.MpesaReceiptNumber;
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
const normalizeStoredPhoneNumber = (value, fieldName) => {
    try {
        return (0, phone_1.normalizePhoneNumber)(value);
    }
    catch {
        throw (0, http_1.createHttpError)(400, `${fieldName} must be a valid Kenyan phone number`);
    }
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
    const approvalThreshold = input.approvalThreshold ?? 2;
    ensureApprovalThresholdInRange(approvalThreshold);
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
                    approvalThreshold,
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
                approvalThreshold: space.approvalThreshold,
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
const updateGroup = async (groupId, actorUserId, dto) => {
    const space = await getSpaceOrThrow(groupId);
    await getSpaceMembershipOrThrow(groupId, actorUserId);
    requireSpaceCreator(space, actorUserId);
    if (dto.approvalThreshold !== undefined) {
        ensureApprovalThresholdInRange(dto.approvalThreshold);
        const adminCount = await prisma_1.prisma.spaceMember.count({
            where: {
                spaceId: groupId,
                role: 'admin',
            },
        });
        if (dto.approvalThreshold > adminCount) {
            throw (0, http_1.createHttpError)(409, 'approvalThreshold cannot exceed the number of admins');
        }
    }
    const updatedSpace = await prisma_1.prisma.space.update({
        where: {
            id: groupId,
        },
        data: {
            name: dto.name,
            description: Object.prototype.hasOwnProperty.call(dto, 'description')
                ? dto.description ?? null
                : undefined,
            imageUrl: dto.imageUrl,
            approvalThreshold: dto.approvalThreshold,
            targetAmount: dto.targetAmount,
            deadline: Object.prototype.hasOwnProperty.call(dto, 'deadline')
                ? dto.deadline
                    ? new Date(dto.deadline)
                    : null
                : undefined,
        },
    });
    const balance = await (0, exports.getCompletedBalanceForSpace)(groupId);
    return mapDbSpaceToGroup(updatedSpace, balance);
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
const processMpesaWebhookPayment = async (input) => {
    const { accountNumber, amount, externalName, phoneNumber, reference, source = contracts_1.TransactionSource.MPESA_PAYBILL, } = input;
    const space = await prisma_1.prisma.space.findUnique({
        where: {
            accountNumber,
        },
    });
    if (!space) {
        throw (0, http_1.createHttpError)(404, 'Space not found for this account number');
    }
    const normalizedPhoneNumber = normalizeStoredPhoneNumber(phoneNumber, 'phoneNumber');
    const existingTransaction = await prisma_1.prisma.transaction.findUnique({
        where: {
            reference,
        },
    });
    if (existingTransaction) {
        return {
            deposit: mapDbTransactionToContractTransaction(existingTransaction),
            duplicate: true,
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
                reference,
                source,
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
                    reference,
                },
            });
            if (!duplicateTransaction) {
                throw error;
            }
            return {
                deposit: mapDbTransactionToContractTransaction(duplicateTransaction),
                duplicate: true,
                group: mapDbSpaceToGroup(space),
            };
        }
        throw error;
    }
};
exports.processMpesaWebhookPayment = processMpesaWebhookPayment;
const createDeposit = async (input) => {
    if (input.amount <= 0) {
        throw (0, http_1.createHttpError)(400, 'amount must be a positive number');
    }
    if (input.source !== contracts_1.TransactionSource.MPESA) {
        throw (0, http_1.createHttpError)(400, 'Payment method not yet supported');
    }
    if (!input.phoneNumber) {
        throw (0, http_1.createHttpError)(400, 'phoneNumber must be a valid Kenyan phone number');
    }
    const space = await prisma_1.prisma.space.findUnique({
        where: {
            id: input.spaceId,
        },
    });
    if (!space) {
        throw (0, http_1.createHttpError)(404, 'Group not found');
    }
    const reference = input.reference?.trim() || (0, http_1.createId)('deposit_ref');
    const transactionStatus = input.userId
        ? contracts_1.TransactionStatus.INITIATED
        : contracts_1.TransactionStatus.PENDING;
    const normalizedPhoneNumber = normalizeStoredPhoneNumber(input.phoneNumber, 'phoneNumber');
    try {
        const transaction = await prisma_1.prisma.transaction.create({
            data: {
                spaceId: input.spaceId,
                userId: input.userId,
                type: contracts_1.TransactionType.DEPOSIT,
                status: transactionStatus,
                amount: input.amount,
                reference,
                source: input.source,
                phoneNumber: normalizedPhoneNumber,
                externalName: input.externalName,
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
const createWithdrawal = async (spaceId, userId, amount, details) => {
    if (amount <= 0) {
        throw (0, http_1.createHttpError)(400, 'amount must be a positive number');
    }
    if (!details.reason.trim()) {
        throw (0, http_1.createHttpError)(400, 'reason must be a non-empty string');
    }
    if (!details.recipientPhoneNumber.trim()) {
        throw (0, http_1.createHttpError)(400, 'recipientPhoneNumber must be a non-empty string');
    }
    const normalizedRecipientPhoneNumber = normalizeStoredPhoneNumber(details.recipientPhoneNumber, 'recipientPhoneNumber');
    if (!details.recipientName.trim()) {
        throw (0, http_1.createHttpError)(400, 'recipientName must be a non-empty string');
    }
    const space = await getSpaceOrThrow(spaceId);
    await getSpaceMembershipOrThrow(spaceId, userId);
    if (userId !== space.createdById) {
        throw (0, http_1.createHttpError)(403, 'Only the space creator can initiate withdrawals');
    }
    const adminCount = await prisma_1.prisma.spaceMember.count({
        where: {
            spaceId,
            role: 'admin',
        },
    });
    if (adminCount < 2) {
        throw (0, http_1.createHttpError)(409, 'At least 2 admins required before withdrawals');
    }
    const activeWithdrawal = await prisma_1.prisma.transaction.findFirst({
        where: {
            spaceId,
            type: contracts_1.TransactionType.WITHDRAWAL,
            status: {
                in: [contracts_1.TransactionStatus.PENDING_APPROVAL, contracts_1.TransactionStatus.APPROVED],
            },
        },
    });
    if (activeWithdrawal) {
        throw (0, http_1.createHttpError)(409, 'Please wait for the current withdrawal to complete before starting a new one.');
    }
    const availableBalance = await (0, exports.getAvailableBalanceForSpace)(spaceId);
    if (amount > availableBalance) {
        throw (0, http_1.createHttpError)(409, 'Insufficient funds in this space');
    }
    const withdrawal = await prisma_1.prisma.transaction.create({
        data: {
            spaceId,
            userId,
            type: contracts_1.TransactionType.WITHDRAWAL,
            status: contracts_1.TransactionStatus.PENDING_APPROVAL,
            amount,
            reference: (0, http_1.createId)('withdrawal_ref'),
            source: contracts_1.TransactionSource.BANK_TRANSFER,
            description: details.reason.trim(),
            recipientPhoneNumber: normalizedRecipientPhoneNumber,
            recipientName: details.recipientName.trim(),
        },
    });
    return mapDbTransactionToContractTransaction(withdrawal);
};
exports.createWithdrawal = createWithdrawal;
const approveWithdrawal = async (withdrawalId, userId) => {
    const withdrawal = await prisma_1.prisma.transaction.findUnique({
        where: {
            id: withdrawalId,
        },
        include: {
            space: true,
            approvals: true,
        },
    });
    if (!withdrawal) {
        throw (0, http_1.createHttpError)(404, 'Withdrawal not found');
    }
    if (withdrawal.type !== contracts_1.TransactionType.WITHDRAWAL) {
        throw (0, http_1.createHttpError)(400, 'Only withdrawals can be approved');
    }
    if (withdrawal.status !== contracts_1.TransactionStatus.PENDING_APPROVAL) {
        throw (0, http_1.createHttpError)(409, 'Withdrawal is no longer pending approval');
    }
    await requireSpaceAdmin(withdrawal.spaceId, userId);
    if (withdrawal.userId === userId) {
        throw (0, http_1.createHttpError)(403, 'Creator cannot approve their own withdrawal');
    }
    try {
        const updatedWithdrawal = await prisma_1.prisma.$transaction(async (tx) => {
            await tx.withdrawalApproval.create({
                data: {
                    transactionId: withdrawal.id,
                    adminId: userId,
                    status: 'approved',
                },
            });
            const approvedCount = await tx.withdrawalApproval.count({
                where: {
                    transactionId: withdrawal.id,
                    status: 'approved',
                },
            });
            const nextStatus = approvedCount >= getSpaceApprovalThreshold(withdrawal.space)
                ? contracts_1.TransactionStatus.APPROVED
                : contracts_1.TransactionStatus.PENDING_APPROVAL;
            return tx.transaction.update({
                where: {
                    id: withdrawal.id,
                },
                data: {
                    status: nextStatus,
                },
            });
        });
        return mapDbTransactionToContractTransaction(updatedWithdrawal);
    }
    catch (error) {
        if (isUniqueConstraintError(error)) {
            throw (0, http_1.createHttpError)(409, 'You have already approved or rejected this withdrawal');
        }
        throw error;
    }
};
exports.approveWithdrawal = approveWithdrawal;
const rejectWithdrawal = async (transactionId, userId) => {
    const withdrawal = await prisma_1.prisma.transaction.findUnique({
        where: {
            id: transactionId,
        },
    });
    if (!withdrawal) {
        throw (0, http_1.createHttpError)(404, 'Withdrawal not found');
    }
    if (withdrawal.type !== contracts_1.TransactionType.WITHDRAWAL) {
        throw (0, http_1.createHttpError)(400, 'Only withdrawals can be rejected');
    }
    if (withdrawal.status !== contracts_1.TransactionStatus.PENDING_APPROVAL) {
        throw (0, http_1.createHttpError)(409, 'Only pending withdrawals can be rejected');
    }
    await requireSpaceAdmin(withdrawal.spaceId, userId);
    try {
        const rejectedWithdrawal = await prisma_1.prisma.$transaction(async (tx) => {
            await tx.withdrawalApproval.create({
                data: {
                    transactionId,
                    adminId: userId,
                    status: 'rejected',
                },
            });
            return tx.transaction.update({
                where: {
                    id: transactionId,
                },
                data: {
                    status: contracts_1.TransactionStatus.REJECTED,
                },
            });
        });
        return mapDbTransactionToContractTransaction(rejectedWithdrawal);
    }
    catch (error) {
        if (isUniqueConstraintError(error)) {
            throw (0, http_1.createHttpError)(409, 'You have already approved or rejected this withdrawal');
        }
        throw error;
    }
};
exports.rejectWithdrawal = rejectWithdrawal;
const executeWithdrawal = async (transactionId, executorUserId) => {
    const result = await prisma_1.prisma.$transaction(async (tx) => {
        const withdrawal = await tx.transaction.findUnique({
            where: {
                id: transactionId,
            },
        });
        if (!withdrawal) {
            throw (0, http_1.createHttpError)(404, 'Withdrawal not found');
        }
        if (withdrawal.type !== contracts_1.TransactionType.WITHDRAWAL) {
            throw (0, http_1.createHttpError)(400, 'Only withdrawals can be executed');
        }
        if (executorUserId) {
            const executorMembership = await tx.spaceMember.findFirst({
                where: {
                    spaceId: withdrawal.spaceId,
                    userId: executorUserId,
                },
            });
            if (!executorMembership || executorMembership.role !== 'admin') {
                throw (0, http_1.createHttpError)(403, 'Only admins can execute withdrawals');
            }
        }
        const existingFee = await tx.transaction.findUnique({
            where: {
                reference: `${withdrawal.reference}_fee`,
            },
        });
        if (withdrawal.status === contracts_1.TransactionStatus.COMPLETED) {
            return {
                fee: existingFee,
                withdrawal,
            };
        }
        if (withdrawal.status !== contracts_1.TransactionStatus.APPROVED) {
            throw (0, http_1.createHttpError)(409, 'Withdrawal must be approved before execution');
        }
        const feeAmount = calculateWithdrawalFee(Number(withdrawal.amount));
        const [completedDeposits, reservedWithdrawals, completedFees] = await Promise.all([
            tx.transaction.aggregate({
                where: {
                    spaceId: withdrawal.spaceId,
                    type: contracts_1.TransactionType.DEPOSIT,
                    status: contracts_1.TransactionStatus.COMPLETED,
                },
                _sum: {
                    amount: true,
                },
            }),
            tx.transaction.aggregate({
                where: {
                    spaceId: withdrawal.spaceId,
                    type: contracts_1.TransactionType.WITHDRAWAL,
                    status: {
                        in: [contracts_1.TransactionStatus.APPROVED, contracts_1.TransactionStatus.COMPLETED],
                    },
                },
                _sum: {
                    amount: true,
                },
            }),
            tx.transaction.aggregate({
                where: {
                    spaceId: withdrawal.spaceId,
                    type: contracts_1.TransactionType.FEE,
                    status: contracts_1.TransactionStatus.COMPLETED,
                },
                _sum: {
                    amount: true,
                },
            }),
        ]);
        const availableAfterReservation = roundCurrency(Number(completedDeposits._sum.amount ?? 0) -
            Number(reservedWithdrawals._sum.amount ?? 0) -
            Number(completedFees._sum.amount ?? 0));
        if (!existingFee && feeAmount > availableAfterReservation) {
            throw (0, http_1.createHttpError)(409, 'Insufficient funds to cover withdrawal fees');
        }
        let feeTransaction = existingFee;
        if (feeAmount > 0 && !feeTransaction) {
            try {
                feeTransaction = await tx.transaction.create({
                    data: {
                        spaceId: withdrawal.spaceId,
                        userId: withdrawal.userId,
                        type: contracts_1.TransactionType.FEE,
                        status: contracts_1.TransactionStatus.COMPLETED,
                        amount: feeAmount,
                        reference: `${withdrawal.reference}_fee`,
                        source: contracts_1.TransactionSource.SYSTEM_FEE,
                        description: 'Withdrawal processing fee',
                    },
                });
            }
            catch (error) {
                if (!isUniqueConstraintError(error)) {
                    throw error;
                }
                feeTransaction = await tx.transaction.findUnique({
                    where: {
                        reference: `${withdrawal.reference}_fee`,
                    },
                });
            }
        }
        const completedWithdrawal = await tx.transaction.update({
            where: {
                id: transactionId,
            },
            data: {
                status: contracts_1.TransactionStatus.COMPLETED,
            },
        });
        return {
            fee: feeTransaction,
            withdrawal: completedWithdrawal,
        };
    });
    return {
        withdrawal: mapDbTransactionToContractTransaction(result.withdrawal),
        fee: result.fee ? mapDbTransactionToContractTransaction(result.fee) : null,
    };
};
exports.executeWithdrawal = executeWithdrawal;
const listWithdrawalApprovals = async (transactionId) => {
    const approvals = await prisma_1.prisma.withdrawalApproval.findMany({
        where: {
            transactionId,
        },
        orderBy: {
            createdAt: 'asc',
        },
    });
    return approvals.map(mapDbWithdrawalApprovalToContractApproval);
};
exports.listWithdrawalApprovals = listWithdrawalApprovals;
const getTransactionsSummary = async (spaceId) => {
    const space = await prisma_1.prisma.space.findUnique({
        where: {
            id: spaceId,
        },
    });
    if (!space) {
        throw (0, http_1.createHttpError)(404, 'Group not found');
    }
    const [completedTransactions, pendingDepositTransactions, activeWithdrawals] = await Promise.all([
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
        prisma_1.prisma.transaction.findMany({
            where: {
                spaceId,
                type: contracts_1.TransactionType.WITHDRAWAL,
                status: {
                    in: [contracts_1.TransactionStatus.PENDING_APPROVAL, contracts_1.TransactionStatus.APPROVED],
                },
            },
            include: {
                approvals: {
                    where: {
                        status: 'approved',
                    },
                },
                user: true,
            },
            orderBy: {
                createdAt: 'desc',
            },
        }),
    ]);
    const completedDeposits = completedTransactions.filter((transaction) => transaction.type === contracts_1.TransactionType.DEPOSIT);
    const completedWithdrawals = completedTransactions.filter((transaction) => transaction.type === contracts_1.TransactionType.WITHDRAWAL);
    const completedFees = completedTransactions.filter((transaction) => transaction.type === contracts_1.TransactionType.FEE);
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
    const pendingWithdrawalsSummary = activeWithdrawals.map((withdrawal) => {
        const userName = withdrawal.user?.name ?? withdrawal.userId ?? 'Unknown member';
        const approvalIds = withdrawal.approvals.map((approval) => approval.adminId);
        return {
            id: withdrawal.id,
            requestedByUserId: withdrawal.userId ?? `external_${withdrawal.id}`,
            requestedByName: userName,
            amount: Number(withdrawal.amount),
            recipientName: withdrawal.recipientName ?? undefined,
            recipientPhoneNumber: withdrawal.recipientPhoneNumber ?? undefined,
            reason: withdrawal.description ?? undefined,
            approvals: approvalIds,
            requiredApprovals: getSpaceApprovalThreshold(space),
            status: withdrawal.status === contracts_1.TransactionStatus.APPROVED ? 'approved' : 'pending',
            createdAt: withdrawal.createdAt.toISOString(),
        };
    });
    const totalDeposits = completedDeposits.reduce((sum, deposit) => sum + Number(deposit.amount), 0);
    const totalWithdrawals = completedWithdrawals.reduce((sum, withdrawal) => sum + Number(withdrawal.amount), 0);
    const totalFees = completedFees.reduce((sum, fee) => sum + Number(fee.amount), 0);
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
        currentBalance: totalDeposits - totalWithdrawals - totalFees,
        depositsOverTime,
        withdrawalsOverTime,
        pendingWithdrawals: pendingWithdrawalsSummary,
        pendingDeposits: pendingDepositsSummary,
        hasPendingTransactions: pendingDepositsSummary.length > 0 || pendingWithdrawalsSummary.length > 0,
    };
};
exports.getTransactionsSummary = getTransactionsSummary;
const promoteMember = async (groupId, memberId, actorUserId) => {
    const space = await getSpaceOrThrow(groupId);
    await getSpaceMembershipOrThrow(groupId, actorUserId);
    requireSpaceCreator(space, actorUserId);
    const member = await prisma_1.prisma.spaceMember.findFirst({
        where: {
            id: memberId,
            spaceId: groupId,
        },
    });
    if (!member) {
        throw (0, http_1.createHttpError)(404, 'Group member not found');
    }
    if (member.role === 'admin') {
        throw (0, http_1.createHttpError)(409, 'Member is already a signatory');
    }
    const adminCount = await prisma_1.prisma.spaceMember.count({
        where: {
            spaceId: groupId,
            role: 'admin',
        },
    });
    if (adminCount >= 3) {
        throw (0, http_1.createHttpError)(409, 'This group already has the maximum number of signatories');
    }
    const updatedMember = await prisma_1.prisma.spaceMember.update({
        where: {
            id: member.id,
        },
        data: {
            role: 'admin',
        },
    });
    return mapDbSpaceMemberToGroupMember(updatedMember);
};
exports.promoteMember = promoteMember;
const revokeMember = async (groupId, memberId, actorUserId) => {
    const space = await getSpaceOrThrow(groupId);
    await getSpaceMembershipOrThrow(groupId, actorUserId);
    requireSpaceCreator(space, actorUserId);
    const member = await prisma_1.prisma.spaceMember.findFirst({
        where: {
            id: memberId,
            spaceId: groupId,
        },
    });
    if (!member) {
        throw (0, http_1.createHttpError)(404, 'Group member not found');
    }
    if (member.userId === space.createdById) {
        throw (0, http_1.createHttpError)(409, 'The account creator cannot be revoked as a signatory');
    }
    if (member.role !== 'admin') {
        throw (0, http_1.createHttpError)(409, 'Only signatories can be revoked');
    }
    const adminCount = await prisma_1.prisma.spaceMember.count({
        where: {
            spaceId: groupId,
            role: 'admin',
        },
    });
    if (adminCount <= 2) {
        throw (0, http_1.createHttpError)(409, 'At least 2 admins must remain in the group');
    }
    const updatedMember = await prisma_1.prisma.spaceMember.update({
        where: {
            id: member.id,
        },
        data: {
            role: 'member',
        },
    });
    if (space.approvalThreshold > adminCount - 1) {
        await prisma_1.prisma.space.update({
            where: {
                id: groupId,
            },
            data: {
                approvalThreshold: adminCount - 1,
            },
        });
    }
    return mapDbSpaceMemberToGroupMember(updatedMember);
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
