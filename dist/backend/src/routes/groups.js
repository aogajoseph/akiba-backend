"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const store_1 = require("../data/store");
const http_1 = require("../utils/http");
const auth_1 = require("../utils/auth");
const groupService_1 = require("../services/groupService");
const router = (0, express_1.Router)();
const getCurrentUser = async (headerValue) => {
    const userId = (0, http_1.ensureNonEmptyString)(headerValue, 'x-user-id header is required');
    return (0, auth_1.getCurrentUserOrThrow)(userId);
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
const toAdmin = (item) => {
    return {
        userId: item.userId,
        name: item.name,
        role: 'admin',
    };
};
const toSpaceMember = (member) => {
    const user = store_1.users.find((item) => item.id === member.userId);
    return {
        ...member,
        name: user?.name ?? member.userId,
    };
};
const buildAdminsResponse = (groupId, userId) => {
    const report = (0, groupService_1.getSignatoryReport)(groupId, userId);
    const admins = report.signatories.map(toAdmin);
    return {
        data: {
            admins,
            remainingSlots: report.remainingSlots,
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
router.post('/', async (req, res, next) => {
    try {
        const user = await getCurrentUser(req.header('x-user-id'));
        const body = (0, http_1.getObjectBody)(req.body);
        const dto = {
            name: (0, http_1.ensureNonEmptyString)(body.name, 'name is required'),
            description: (0, http_1.ensureOptionalNonEmptyString)(body.description, 'description must be a non-empty string'),
            image: (0, http_1.ensureOptionalNonEmptyString)(body.image, 'image must be a non-empty string'),
            approvalThreshold: (0, http_1.ensurePositiveInteger)(body.approvalThreshold, 'approvalThreshold must be a positive integer'),
            targetAmount: body.targetAmount === undefined || body.targetAmount === null
                ? undefined
                : (0, http_1.ensurePositiveNumber)(body.targetAmount, 'targetAmount must be a positive number'),
            deadline: ensureOptionalFutureDateString(body.deadline),
        };
        const { space } = await (0, groupService_1.createSpace)({
            name: dto.name,
            description: dto.description,
            imageUrl: dto.image,
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
        const memberships = store_1.groupMembers.filter((item) => item.userId === user.id);
        const visibleGroups = store_1.groups.filter((group) => memberships.some((membership) => membership.groupId === group.id));
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
        const group = getGroupById(spaceId);
        requireMembership(group.id, user.id);
        const response = {
            data: await (0, groupService_1.getTransactionsSummary)(spaceId),
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
        const group = getGroupById(spaceId);
        requireMembership(group.id, user.id);
        const body = (0, http_1.getObjectBody)(req.body);
        const amount = (0, http_1.ensurePositiveNumber)(body.amount, 'amount must be a positive number');
        const deposit = await (0, groupService_1.createDeposit)(spaceId, user.id, amount);
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
        const group = getGroupById(spaceId);
        requireMembership(group.id, user.id);
        const body = (0, http_1.getObjectBody)(req.body);
        const amount = (0, http_1.ensurePositiveNumber)(body.amount, 'amount must be a positive number');
        const reason = (0, http_1.ensureOptionalNonEmptyString)(body.reason, 'reason must be a non-empty string');
        const withdrawal = await (0, groupService_1.createWithdrawal)(spaceId, user.id, amount, reason);
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
router.get('/:groupId', async (req, res, next) => {
    try {
        const user = await getCurrentUser(req.header('x-user-id'));
        const group = getGroupById(req.params.groupId);
        requireMembership(group.id, user.id);
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
            dto.imageUrl = imageUrlField.value;
        }
        if (body.approvalThreshold !== undefined) {
            dto.approvalThreshold = (0, http_1.ensurePositiveInteger)(body.approvalThreshold, 'approvalThreshold must be a positive integer');
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
        const group = (0, groupService_1.updateGroup)(req.params.groupId, user.id, dto);
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
        (0, groupService_1.deleteGroup)(req.params.groupId, user.id);
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
        const group = getGroupById(req.params.groupId);
        const existingMembership = store_1.groupMembers.find((item) => item.groupId === group.id && item.userId === user.id);
        if (existingMembership) {
            throw (0, http_1.createHttpError)(409, 'User is already a member of this group');
        }
        const member = (0, groupService_1.joinGroup)(group.id, user.id);
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
        const member = (0, groupService_1.leaveGroup)(req.params.groupId, req.params.memberId, user.id);
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
        const group = getGroupById(req.params.groupId);
        requireMembership(group.id, user.id);
        const members = store_1.groupMembers
            .filter((item) => item.groupId === group.id)
            .map(toSpaceMember);
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
        res.json(buildAdminsResponse(req.params.groupId, user.id));
    }
    catch (error) {
        next(error);
    }
});
router.get('/:groupId/admins', async (req, res, next) => {
    try {
        const user = await getCurrentUser(req.header('x-user-id'));
        res.json(buildAdminsResponse(req.params.groupId, user.id));
    }
    catch (error) {
        next(error);
    }
});
router.post('/:groupId/members/:memberId/promote', async (req, res, next) => {
    try {
        const user = await getCurrentUser(req.header('x-user-id'));
        const member = (0, groupService_1.promoteMember)(req.params.groupId, req.params.memberId, user.id);
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
        const member = (0, groupService_1.revokeMember)(req.params.groupId, req.params.memberId, user.id);
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
