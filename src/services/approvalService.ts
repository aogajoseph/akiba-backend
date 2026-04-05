import { Approval } from '../../../shared/contracts';
import { prisma } from '../lib/prisma';

const mapDbApprovalToContractApproval = (approval: {
  adminId: string;
  createdAt: Date;
  id: string;
  status: string;
  transactionId: string;
}): Approval => {
  return {
    id: approval.id,
    transactionId: approval.transactionId,
    signatoryUserId: approval.adminId,
    status: approval.status as Approval['status'],
    createdAt: approval.createdAt.toISOString(),
  };
};

export const listApprovals = async (transactionId: string): Promise<Approval[]> => {
  const approvals = await prisma.withdrawalApproval.findMany({
    where: {
      transactionId,
    },
    orderBy: {
      createdAt: 'asc',
    },
  });

  return approvals.map(mapDbApprovalToContractApproval);
};

export const getApprovalByTransactionAndAdmin = async (
  transactionId: string,
  adminId: string,
): Promise<Approval | null> => {
  const approval = await prisma.withdrawalApproval.findUnique({
    where: {
      transactionId_adminId: {
        transactionId,
        adminId,
      },
    },
  });

  return approval ? mapDbApprovalToContractApproval(approval) : null;
};
