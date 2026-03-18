import { Router } from 'express';

import {
  ApiResponse,
  CreateApprovalResponseDto,
  ListApprovalsResponseDto,
} from '../../../shared/contracts';
import { approvals, transactions } from '../data/store';

const router = Router({ mergeParams: true });

router.get('/', (req, res) => {
  const transactionApprovals = approvals.filter(
    (item) => item.transactionId === req.params.transactionId,
  );
  const response: ApiResponse<ListApprovalsResponseDto> = {
    data: {
      approvals: transactionApprovals.length > 0 ? transactionApprovals : approvals,
    },
  };

  res.json(response);
});

router.post('/', (req, res) => {
  const approval = approvals.find((item) => item.transactionId === req.params.transactionId) ?? approvals[0];
  const transaction =
    transactions.find((item) => item.id === req.params.transactionId) ?? transactions[0];

  const response: ApiResponse<CreateApprovalResponseDto> = {
    data: {
      approval,
      transaction,
    },
  };

  res.status(201).json(response);
});

export default router;
