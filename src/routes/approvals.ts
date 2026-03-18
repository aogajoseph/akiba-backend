import { Router } from 'express';

import {
  ApiResponse,
  CreateApprovalRequestDto,
  CreateApprovalResponseDto,
  ListApprovalsResponseDto,
} from '../../../shared/contracts';
import { getTransaction } from '../services/transactionService';
import { createApproval, listApprovals } from '../services/approvalService';

const router = Router({ mergeParams: true });

const getCurrentUserId = (headerValue: string | undefined): string => {
  return headerValue ?? 'user_1';
};

router.get('/', (req, res) => {
  try {
    const { transactionId } = req.params;
    const approvalList = listApprovals(transactionId);
    const response: ApiResponse<ListApprovalsResponseDto> = {
      data: {
        approvals: approvalList,
      },
    };

    res.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to list approvals';
    res.status(400).json({ error: message });
  }
});

router.post('/', (req, res) => {
  try {
    const { groupId, transactionId } = req.params;
    const signatoryUserId = getCurrentUserId(req.header('x-user-id'));
    const dto = req.body as CreateApprovalRequestDto;
    const approval = createApproval(transactionId, signatoryUserId, dto);
    const transaction = getTransaction(groupId, transactionId);

    const response: ApiResponse<CreateApprovalResponseDto> = {
      data: {
        approval,
        transaction,
      },
    };

    res.status(201).json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create approval';
    res.status(400).json({ error: message });
  }
});

export default router;
