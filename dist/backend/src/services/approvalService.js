"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getApprovalByTransactionAndAdmin = exports.listApprovals = void 0;
const prisma_1 = require("../lib/prisma");
const mapDbApprovalToContractApproval = (approval) => {
    return {
        id: approval.id,
        transactionId: approval.transactionId,
        signatoryUserId: approval.adminId,
        status: approval.status,
        createdAt: approval.createdAt.toISOString(),
    };
};
const listApprovals = async (transactionId) => {
    const approvals = await prisma_1.prisma.withdrawalApproval.findMany({
        where: {
            transactionId,
        },
        orderBy: {
            createdAt: 'asc',
        },
    });
    return approvals.map(mapDbApprovalToContractApproval);
};
exports.listApprovals = listApprovals;
const getApprovalByTransactionAndAdmin = async (transactionId, adminId) => {
    const approval = await prisma_1.prisma.withdrawalApproval.findUnique({
        where: {
            transactionId_adminId: {
                transactionId,
                adminId,
            },
        },
    });
    return approval ? mapDbApprovalToContractApproval(approval) : null;
};
exports.getApprovalByTransactionAndAdmin = getApprovalByTransactionAndAdmin;
