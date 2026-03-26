"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteGroup = exports.leaveGroup = exports.revokeMember = exports.promoteMember = exports.getSignatoryReport = exports.joinGroup = exports.createGroup = void 0;
const contracts_1 = require("../../../shared/contracts");
const store_1 = require("../data/store");
const http_1 = require("../utils/http");
const MAX_SIGNATORIES = 3;
const JOINABLE_SIGNATORY_ROLES = [
    'primary',
    'secondary',
    'tertiary',
];
const PROMOTABLE_SIGNATORY_ROLES = ['secondary', 'tertiary'];
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
const createGroup = (userId, dto) => {
    if (dto.approvalThreshold > MAX_SIGNATORIES) {
        throw (0, http_1.createHttpError)(400, 'approvalThreshold cannot exceed the maximum signatories (3)');
    }
    const group = {
        id: (0, http_1.createId)('group'),
        name: dto.name,
        description: dto.description,
        imageUrl: dto.image,
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
const getSignatoryReport = (groupId, requesterUserId) => {
    getGroupOrThrow(groupId);
    requireRequesterMembership(groupId, requesterUserId);
    const signatories = getSignatoriesForGroup(groupId)
        .map((member) => {
        const user = store_1.users.find((item) => item.id === member.userId);
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
