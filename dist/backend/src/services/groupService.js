"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteGroup = exports.leaveGroup = exports.revokeMember = exports.promoteMember = exports.getTransactionsSummary = exports.approveWithdrawal = exports.createWithdrawal = exports.createDeposit = exports.processMpesaWebhookPayment = exports.getSignatoryReport = exports.joinGroup = exports.updateGroup = exports.createGroup = exports.finalizeWebhookLog = exports.storeWebhookPayload = void 0;
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
const deposits = [];
const withdrawals = [];
const webhookLogs = [];
const getMpesaPaybillNumber = () => {
    return process.env.MPESA_PAYBILL?.trim() || '522522';
};
const storeWebhookPayload = (payload) => {
    const logId = (0, http_1.createId)('mpesa_webhook');
    webhookLogs.push({
        id: logId,
        payload,
        receivedAt: new Date().toISOString(),
    });
    return logId;
};
exports.storeWebhookPayload = storeWebhookPayload;
const finalizeWebhookLog = (logId, result) => {
    const logEntry = webhookLogs.find((entry) => entry.id === logId);
    if (!logEntry) {
        return;
    }
    logEntry.processedAt = new Date().toISOString();
    logEntry.result = result;
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
const processMpesaWebhookPayment = async (amount, accountNumber, phoneNumber, receiptCode) => {
    const group = store_1.groups.find((item) => item.accountNumber === accountNumber);
    if (!group) {
        throw (0, http_1.createHttpError)(404, 'Space not found for this account number');
    }
    const existingTransaction = store_1.transactions.find((transaction) => transaction.reference === receiptCode);
    if (existingTransaction) {
        return { deposit: null, duplicate: true, group };
    }
    const normalizedPhoneNumber = normalizePhoneNumber(phoneNumber);
    const matchedUser = store_1.users.find((user) => normalizePhoneNumber(user.phoneNumber) === normalizedPhoneNumber);
    const deposit = {
        id: `dep_${Date.now()}`,
        spaceId: group.id,
        userId: matchedUser?.id ?? `mpesa_${normalizedPhoneNumber}`,
        amount,
        status: 'completed',
        createdAt: new Date().toISOString(),
    };
    const transaction = {
        id: (0, http_1.createId)('txn'),
        groupId: group.id,
        initiatedByUserId: deposit.userId,
        type: contracts_1.TransactionType.DEPOSIT,
        amount,
        currency: 'KES',
        description: `M-Pesa Paybill deposit via ${group.paybillNumber}`,
        source: 'mpesa_paybill',
        reference: receiptCode,
        phoneNumber: normalizedPhoneNumber,
        status: contracts_1.TransactionStatus.COMPLETED,
        createdAt: deposit.createdAt,
    };
    deposits.push(deposit);
    store_1.transactions.push(transaction);
    group.collectedAmount = (group.collectedAmount ?? 0) + amount;
    return { deposit, duplicate: false, group };
};
exports.processMpesaWebhookPayment = processMpesaWebhookPayment;
const createDeposit = async (spaceId, userId, amount) => {
    if (amount <= 0) {
        throw (0, http_1.createHttpError)(400, 'amount must be a positive number');
    }
    const group = getGroupOrThrow(spaceId);
    const deposit = {
        id: `dep_${Date.now()}`,
        spaceId,
        userId,
        amount,
        status: 'pending',
        createdAt: new Date().toISOString(),
    };
    deposits.push(deposit);
    setTimeout(() => {
        if (deposit.status !== 'pending') {
            return;
        }
        deposit.status = 'completed';
        group.collectedAmount = (group.collectedAmount ?? 0) + amount;
    }, 2500);
    return deposit;
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
    getGroupOrThrow(spaceId);
    const completedDeposits = deposits.filter((deposit) => deposit.spaceId === spaceId && deposit.status === 'completed');
    const pendingDeposits = deposits
        .filter((deposit) => deposit.spaceId === spaceId && deposit.status === 'pending')
        .map((deposit) => {
        const user = store_1.users.find((item) => item.id === deposit.userId);
        return {
            id: deposit.id,
            userId: deposit.userId,
            userName: user?.name ?? deposit.userId,
            amount: deposit.amount,
            status: deposit.status,
            createdAt: deposit.createdAt,
        };
    });
    const completedWithdrawals = withdrawals.filter((withdrawal) => withdrawal.spaceId === spaceId && withdrawal.status === 'completed');
    const pendingWithdrawals = withdrawals
        .filter((withdrawal) => withdrawal.spaceId === spaceId &&
        (withdrawal.status === 'pending' || withdrawal.status === 'approved'))
        .map((withdrawal) => {
        const user = store_1.users.find((item) => item.id === withdrawal.requestedByUserId);
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
    const totalDeposits = completedDeposits.reduce((sum, deposit) => sum + deposit.amount, 0);
    const totalWithdrawals = completedWithdrawals.reduce((sum, withdrawal) => sum + withdrawal.amount, 0);
    let runningTotal = 0;
    const depositsOverTime = completedDeposits.map((deposit) => {
        runningTotal += deposit.amount;
        return runningTotal;
    });
    let runningWithdrawals = 0;
    const withdrawalsOverTime = completedWithdrawals.map((withdrawal) => {
        runningWithdrawals += withdrawal.amount;
        return runningWithdrawals;
    });
    return {
        totalDeposits,
        totalWithdrawals,
        currentBalance: totalDeposits - totalWithdrawals,
        depositsOverTime,
        withdrawalsOverTime,
        pendingWithdrawals,
        pendingDeposits,
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
