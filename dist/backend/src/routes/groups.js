"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const prisma_1 = require("../lib/prisma");
const http_1 = require("../utils/http");
const auth_1 = require("../utils/auth");
const groupService_1 = require("../services/groupService");
const router = (0, express_1.Router)();
const getCurrentUser = async (headerValue) => {
    const userId = (0, http_1.ensureNonEmptyString)(headerValue, 'x-user-id header is required');
    return (0, auth_1.getCurrentUserOrThrow)(userId);
};
const getDefaultPaybillNumber = () => {
    return process.env.MPESA_PAYBILL?.trim() || '522522';
};
const mapSpaceToGroup = (space, financials) => {
    return {
        id: space.id,
        name: space.name,
        description: space.description ?? undefined,
        imageUrl: space.imageUrl ?? undefined,
        paybillNumber: space.paybillNumber ?? getDefaultPaybillNumber(),
        accountNumber: space.accountNumber ?? '',
        targetAmount: space.targetAmount ?? undefined,
        collectedAmount: financials?.availableBalance ?? 0,
        deadline: space.deadline?.toISOString(),
        createdByUserId: space.createdById,
        approvalThreshold: 2,
        membersCount: financials?.membersCount,
        totalBalance: financials?.totalBalance,
        totalFees: financials?.totalFees,
        pendingWithdrawalAmount: financials?.pendingWithdrawalAmount,
        reservedAmount: financials?.reservedAmount,
        availableBalance: financials?.availableBalance,
        createdAt: space.createdAt.toISOString(),
    };
};
const getGroupById = async (groupId) => {
    const normalizedGroupId = (0, http_1.ensureNonEmptyString)(groupId, 'groupId is required');
    const space = await prisma_1.prisma.space.findUnique({
        where: {
            id: normalizedGroupId,
        },
    });
    if (!space) {
        throw (0, http_1.createHttpError)(404, 'Group not found');
    }
    const [financialsBySpaceId, membersCount] = await Promise.all([
        (0, groupService_1.getSpaceFinancialSnapshotBySpaceIds)([normalizedGroupId]),
        prisma_1.prisma.spaceMember.count({
            where: {
                spaceId: normalizedGroupId,
            },
        }),
    ]);
    return mapSpaceToGroup(space, {
        ...financialsBySpaceId.get(normalizedGroupId),
        membersCount,
    });
};
const requireMembership = async (groupId, userId) => {
    const normalizedGroupId = (0, http_1.ensureNonEmptyString)(groupId, 'groupId is required');
    const membership = await prisma_1.prisma.spaceMember.findFirst({
        where: {
            spaceId: normalizedGroupId,
            userId,
        },
        include: {
            space: true,
        },
    });
    if (!membership) {
        throw (0, http_1.createHttpError)(403, 'You are not a member of this group');
    }
    return membership;
};
const toAdmin = (item) => {
    return {
        userId: item.userId,
        name: item.name,
        role: 'admin',
    };
};
const buildAdminsResponse = async (groupId, userId) => {
    await getGroupById(groupId);
    await requireMembership(groupId, userId);
    const adminMembers = await prisma_1.prisma.spaceMember.findMany({
        where: {
            spaceId: groupId,
            role: 'admin',
        },
        include: {
            user: true,
        },
    });
    const admins = adminMembers.map((member) => toAdmin({
        userId: member.userId,
        name: member.user?.name ?? member.userId,
    }));
    const remainingSlots = Math.max(0, 3 - admins.length);
    return {
        data: {
            admins,
            remainingSlots,
            signatories: admins,
        },
    };
};
const ensureOptionalFutureDateString = (value) => {
    const deadline = (0, http_1.ensureOptionalNonEmptyString)(value, 'deadline must be a non-empty ISO date string');
    if (!deadline) {
        return undefined;
    }
    const parsedDate = new Date(deadline);
    if (Number.isNaN(parsedDate.getTime())) {
        throw (0, http_1.createHttpError)(400, 'deadline must be a valid ISO date string');
    }
    return parsedDate.toISOString();
};
const parseOptionalIsoDateQuery = (value, fieldName) => {
    const rawValue = (0, http_1.ensureOptionalNonEmptyString)(value, `${fieldName} must be a non-empty ISO date string`);
    if (!rawValue) {
        return undefined;
    }
    const parsedDate = new Date(rawValue);
    if (Number.isNaN(parsedDate.getTime())) {
        throw (0, http_1.createHttpError)(400, `${fieldName} must be a valid ISO date string`);
    }
    return parsedDate;
};
const parseOptionalStringField = (value, message) => {
    if (value === undefined || value === null) {
        return { provided: false, value: undefined };
    }
    if (typeof value !== 'string') {
        throw (0, http_1.createHttpError)(400, message);
    }
    const normalized = value.trim();
    return {
        provided: true,
        value: normalized.length > 0 ? normalized : undefined,
    };
};
const ensureOptionalHttpUrlString = (value, fieldName) => {
    if (!value) {
        return undefined;
    }
    let parsedUrl;
    try {
        parsedUrl = new URL(value);
    }
    catch {
        throw (0, http_1.createHttpError)(400, `${fieldName} must be a valid URL`);
    }
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        throw (0, http_1.createHttpError)(400, `${fieldName} must be an http or https URL`);
    }
    return parsedUrl.toString();
};
router.post('/', async (req, res, next) => {
    try {
        const user = await getCurrentUser(req.header('x-user-id'));
        const body = (0, http_1.getObjectBody)(req.body);
        const imageUrl = ensureOptionalHttpUrlString((0, http_1.ensureOptionalNonEmptyString)(body.imageUrl ?? body.image, 'imageUrl must be a non-empty string'), 'imageUrl');
        const dto = {
            name: (0, http_1.ensureNonEmptyString)(body.name, 'name is required'),
            description: (0, http_1.ensureOptionalNonEmptyString)(body.description, 'description must be a non-empty string'),
            image: imageUrl,
            imageUrl,
            targetAmount: body.targetAmount === undefined || body.targetAmount === null
                ? undefined
                : (0, http_1.ensurePositiveNumber)(body.targetAmount, 'targetAmount must be a positive number'),
            deadline: ensureOptionalFutureDateString(body.deadline),
        };
        const { space } = await (0, groupService_1.createSpace)({
            name: dto.name,
            description: dto.description,
            imageUrl: dto.imageUrl ?? dto.image,
            targetAmount: dto.targetAmount,
            deadline: dto.deadline,
            createdById: user.id,
        });
        const response = {
            data: {
                group: space,
                space,
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
        const user = await getCurrentUser(req.header('x-user-id'));
        const memberships = await prisma_1.prisma.spaceMember.findMany({
            where: {
                userId: user.id,
            },
            include: {
                space: true,
            },
        });
        const spaceIds = memberships.map((membership) => membership.space.id);
        const [financialsBySpaceId, memberCounts] = await Promise.all([
            (0, groupService_1.getSpaceFinancialSnapshotBySpaceIds)(spaceIds),
            prisma_1.prisma.spaceMember.groupBy({
                by: ['spaceId'],
                where: {
                    spaceId: {
                        in: spaceIds,
                    },
                },
                _count: {
                    _all: true,
                },
            }),
        ]);
        const membersCountBySpaceId = new Map(memberCounts.map((item) => [item.spaceId, item._count._all]));
        const visibleGroups = Array.from(new Map(memberships.map((membership) => [
            membership.space.id,
            mapSpaceToGroup(membership.space, {
                ...financialsBySpaceId.get(membership.space.id),
                membersCount: membersCountBySpaceId.get(membership.space.id),
            }),
        ])).values());
        const response = {
            data: {
                groups: visibleGroups,
                spaces: visibleGroups,
            },
        };
        res.json(response);
    }
    catch (error) {
        next(error);
    }
});
router.get('/:spaceId/transactions/summary', async (req, res, next) => {
    try {
        const user = await getCurrentUser(req.header('x-user-id'));
        const { spaceId } = req.params;
        const group = await getGroupById(spaceId);
        await requireMembership(group.id, user.id);
        const response = {
            data: await (0, groupService_1.getTransactionsSummary)(spaceId),
        };
        res.json(response);
    }
    catch (error) {
        next(error);
    }
});
router.get('/:spaceId/summary', async (req, res, next) => {
    try {
        const user = await getCurrentUser(req.header('x-user-id'));
        const { spaceId } = req.params;
        const from = parseOptionalIsoDateQuery(req.query.from, 'from');
        const to = parseOptionalIsoDateQuery(req.query.to, 'to');
        if (from && to && from > to) {
            throw (0, http_1.createHttpError)(400, 'from must be earlier than or equal to to');
        }
        await getGroupById(spaceId);
        await requireMembership(spaceId, user.id);
        const response = {
            data: await (0, groupService_1.getSpaceSummary)(spaceId, { from, to }),
        };
        res.json(response);
    }
    catch (error) {
        next(error);
    }
});
router.post('/:spaceId/deposit', async (req, res, next) => {
    try {
        const user = await getCurrentUser(req.header('x-user-id'));
        const { spaceId } = req.params;
        const group = await getGroupById(spaceId);
        await requireMembership(group.id, user.id);
        const body = (0, http_1.getObjectBody)(req.body);
        const bodySpaceId = (0, http_1.ensureNonEmptyString)(body.spaceId, 'spaceId is required');
        const amount = (0, http_1.ensurePositiveNumber)(body.amount, 'amount must be a positive number');
        const source = (0, http_1.ensureNonEmptyString)(body.source, 'source is required');
        const phoneNumber = (0, http_1.ensureOptionalNonEmptyString)(body.phoneNumber, 'phoneNumber must be a non-empty string');
        if (bodySpaceId !== spaceId) {
            throw (0, http_1.createHttpError)(400, 'spaceId does not match route parameter');
        }
        const deposit = await (0, groupService_1.createDeposit)({
            amount,
            phoneNumber,
            source: source,
            spaceId,
            userId: user.id,
        });
        res.json({
            data: {
                success: true,
                deposit,
            },
        });
    }
    catch (error) {
        next(error);
    }
});
router.post('/:spaceId/withdraw', async (req, res, next) => {
    try {
        const user = await getCurrentUser(req.header('x-user-id'));
        const { spaceId } = req.params;
        const group = await getGroupById(spaceId);
        await requireMembership(group.id, user.id);
        const body = (0, http_1.getObjectBody)(req.body);
        const amount = (0, http_1.ensurePositiveNumber)(body.amount, 'amount must be a positive number');
        const reason = (0, http_1.ensureNonEmptyString)(body.reason, 'reason must be a non-empty string');
        const recipientPhoneNumber = (0, http_1.ensureNonEmptyString)(body.recipientPhoneNumber, 'recipientPhoneNumber must be a non-empty string');
        const recipientName = (0, http_1.ensureNonEmptyString)(body.recipientName, 'recipientName must be a non-empty string');
        const withdrawal = await (0, groupService_1.createWithdrawal)(spaceId, user.id, amount, {
            reason,
            recipientPhoneNumber,
            recipientName,
        });
        res.json({
            data: {
                success: true,
                withdrawal,
            },
        });
    }
    catch (error) {
        next(error);
    }
});
router.post('/withdrawals/:withdrawalId/approve', async (req, res, next) => {
    try {
        const user = await getCurrentUser(req.header('x-user-id'));
        const withdrawal = await (0, groupService_1.approveWithdrawal)(req.params.withdrawalId, user.id);
        res.json({
            data: {
                success: true,
                withdrawal,
            },
        });
    }
    catch (error) {
        next(error);
    }
});
router.post('/transactions/:transactionId/approve', async (req, res, next) => {
    try {
        const user = await getCurrentUser(req.header('x-user-id'));
        const withdrawal = await (0, groupService_1.approveWithdrawal)(req.params.transactionId, user.id);
        res.json({
            data: {
                success: true,
                withdrawal,
            },
        });
    }
    catch (error) {
        next(error);
    }
});
router.post('/transactions/:transactionId/reject', async (req, res, next) => {
    try {
        const user = await getCurrentUser(req.header('x-user-id'));
        const withdrawal = await (0, groupService_1.rejectWithdrawal)(req.params.transactionId, user.id);
        res.json({
            data: {
                success: true,
                withdrawal,
            },
        });
    }
    catch (error) {
        next(error);
    }
});
router.post('/transactions/:transactionId/execute', async (req, res, next) => {
    try {
        const user = await getCurrentUser(req.header('x-user-id'));
        const result = await (0, groupService_1.executeWithdrawal)(req.params.transactionId, user.id);
        res.json({
            data: {
                success: true,
                withdrawal: result.withdrawal,
                fee: result.fee,
            },
        });
    }
    catch (error) {
        next(error);
    }
});
router.get('/:groupId', async (req, res, next) => {
    try {
        const user = await getCurrentUser(req.header('x-user-id'));
        await requireMembership(req.params.groupId, user.id);
        const group = await getGroupById(req.params.groupId);
        const response = {
            data: {
                group,
                space: group,
            },
        };
        res.json(response);
    }
    catch (error) {
        next(error);
    }
});
router.patch('/:groupId', async (req, res, next) => {
    try {
        const user = await getCurrentUser(req.header('x-user-id'));
        const body = (0, http_1.getObjectBody)(req.body);
        const nameField = parseOptionalStringField(body.name, 'name must be a non-empty string');
        const descriptionField = parseOptionalStringField(body.description, 'description must be a string');
        const imageUrlField = parseOptionalStringField(body.imageUrl, 'imageUrl must be a string');
        const deadlineField = parseOptionalStringField(body.deadline, 'deadline must be a valid ISO date string');
        const dto = {};
        if (nameField.provided) {
            dto.name = (0, http_1.ensureNonEmptyString)(nameField.value, 'name must be a non-empty string');
        }
        if (descriptionField.provided) {
            dto.description = descriptionField.value;
        }
        if (imageUrlField.provided) {
            dto.imageUrl = ensureOptionalHttpUrlString(imageUrlField.value, 'imageUrl');
        }
        if (body.targetAmount !== undefined) {
            dto.targetAmount =
                body.targetAmount === null
                    ? undefined
                    : (0, http_1.ensurePositiveNumber)(body.targetAmount, 'targetAmount must be a positive number');
        }
        if (deadlineField.provided) {
            dto.deadline = deadlineField.value
                ? ensureOptionalFutureDateString(deadlineField.value)
                : undefined;
        }
        const group = await (0, groupService_1.updateGroup)(req.params.groupId, user.id, dto);
        const response = {
            data: {
                group,
                space: group,
            },
        };
        res.json(response);
    }
    catch (error) {
        next(error);
    }
});
router.delete('/:groupId', async (req, res, next) => {
    try {
        const user = await getCurrentUser(req.header('x-user-id'));
        await (0, groupService_1.deleteGroup)(req.params.groupId, user.id);
        const response = {
            data: {
                success: true,
            },
        };
        res.json(response);
    }
    catch (error) {
        next(error);
    }
});
router.post('/:groupId/join', async (req, res, next) => {
    try {
        const user = await getCurrentUser(req.header('x-user-id'));
        const group = await getGroupById(req.params.groupId);
        const member = await (0, groupService_1.joinSpace)(group.id, user.id);
        const response = {
            data: {
                member,
            },
        };
        res.status(201).json(response);
    }
    catch (error) {
        next(error);
    }
});
router.delete('/:groupId/members/:memberId/leave', async (req, res, next) => {
    try {
        const user = await getCurrentUser(req.header('x-user-id'));
        const member = await (0, groupService_1.leaveSpace)(req.params.groupId, user.id);
        const response = {
            data: {
                member,
            },
        };
        res.json(response);
    }
    catch (error) {
        next(error);
    }
});
router.get('/:groupId/members', async (req, res, next) => {
    try {
        const user = await getCurrentUser(req.header('x-user-id'));
        const group = await getGroupById(req.params.groupId);
        await requireMembership(group.id, user.id);
        const members = await (0, groupService_1.getSpaceMembers)(group.id);
        const response = {
            data: {
                members,
            },
        };
        res.json(response);
    }
    catch (error) {
        next(error);
    }
});
router.get('/:groupId/signatories', async (req, res, next) => {
    try {
        const user = await getCurrentUser(req.header('x-user-id'));
        res.json(await buildAdminsResponse(req.params.groupId, user.id));
    }
    catch (error) {
        next(error);
    }
});
router.get('/:groupId/admins', async (req, res, next) => {
    try {
        const user = await getCurrentUser(req.header('x-user-id'));
        res.json(await buildAdminsResponse(req.params.groupId, user.id));
    }
    catch (error) {
        next(error);
    }
});
router.post('/:groupId/members/:memberId/promote', async (req, res, next) => {
    try {
        const user = await getCurrentUser(req.header('x-user-id'));
        const member = await (0, groupService_1.promoteMember)(req.params.groupId, req.params.memberId, user.id);
        const response = {
            data: {
                member,
            },
        };
        res.json(response);
    }
    catch (error) {
        next(error);
    }
});
router.post('/:groupId/members/:memberId/revoke', async (req, res, next) => {
    try {
        const user = await getCurrentUser(req.header('x-user-id'));
        const member = await (0, groupService_1.revokeMember)(req.params.groupId, req.params.memberId, user.id);
        const response = {
            data: {
                member,
            },
        };
        res.json(response);
    }
    catch (error) {
        next(error);
    }
});
exports.default = router;
