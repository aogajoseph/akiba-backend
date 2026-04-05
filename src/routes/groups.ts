import { Request, Router } from 'express';

import {
  ApiResponse,
  CreateGroupRequestDto,
  CreateGroupResponseDto,
  DeleteGroupResponseDto,
  GetGroupResponseDto,
  GetTransactionsSummaryResponseDto,
  Group,
  JoinGroupResponseDto,
  LeaveGroupResponseDto,
  ListGroupMembersResponseDto,
  ListGroupSignatoriesResponseDto,
  ListGroupsResponseDto,
  PromoteGroupMemberResponseDto,
  RevokeGroupMemberResponseDto,
  SpaceAdmin,
  TransactionSource,
  UpdateGroupRequestDto,
  UpdateGroupResponseDto,
  User,
} from '../../../shared/contracts';
import { prisma } from '../lib/prisma';
import {
  createHttpError,
  ensureNonEmptyString,
  ensureOptionalNonEmptyString,
  ensurePositiveInteger,
  ensurePositiveNumber,
  getObjectBody,
} from '../utils/http';
import { getCurrentUserOrThrow } from '../utils/auth';
import {
  executeWithdrawal,
  approveWithdrawal,
  createDeposit,
  createSpace,
  createWithdrawal,
  deleteGroup,
  getCompletedBalancesBySpaceIds,
  getTransactionsSummary,
  getSpaceMembers,
  joinSpace,
  leaveSpace,
  promoteMember,
  rejectWithdrawal,
  revokeMember,
  updateGroup,
} from '../services/groupService';

const router = Router();

type GroupParams = {
  groupId: string;
};

type SpaceParams = {
  spaceId: string;
};

type GroupMemberParams = {
  groupId: string;
  memberId: string;
};

const getCurrentUser = async (headerValue: string | undefined): Promise<User> => {
  const userId = ensureNonEmptyString(headerValue, 'x-user-id header is required');
  return getCurrentUserOrThrow(userId);
};

const getDefaultPaybillNumber = (): string => {
  return process.env.MPESA_PAYBILL?.trim() || '522522';
};

const mapSpaceToGroup = (space: {
  accountNumber: string | null;
  approvalThreshold: number;
  createdAt: Date;
  createdById: string;
  deadline: Date | null;
  description: string | null;
  id: string;
  imageUrl: string | null;
  name: string;
  paybillNumber: string | null;
  targetAmount: number | null;
}, collectedAmount = 0): Group => {
  return {
    id: space.id,
    name: space.name,
    description: space.description ?? undefined,
    imageUrl: space.imageUrl ?? undefined,
    paybillNumber: space.paybillNumber ?? getDefaultPaybillNumber(),
    accountNumber: space.accountNumber ?? '',
    targetAmount: space.targetAmount ?? undefined,
    collectedAmount,
    deadline: space.deadline?.toISOString(),
    createdByUserId: space.createdById,
    approvalThreshold: space.approvalThreshold,
    createdAt: space.createdAt.toISOString(),
  };
};

const getGroupById = async (groupId: string): Promise<Group> => {
  const normalizedGroupId = ensureNonEmptyString(groupId, 'groupId is required');
  const space = await prisma.space.findUnique({
    where: {
      id: normalizedGroupId,
    },
  });

  if (!space) {
    throw createHttpError(404, 'Group not found');
  }

  const balancesBySpaceId = await getCompletedBalancesBySpaceIds([normalizedGroupId]);
  return mapSpaceToGroup(space, balancesBySpaceId.get(normalizedGroupId) ?? 0);
};

const requireMembership = async (groupId: string, userId: string) => {
  const normalizedGroupId = ensureNonEmptyString(groupId, 'groupId is required');
  const membership = await prisma.spaceMember.findFirst({
    where: {
      spaceId: normalizedGroupId,
      userId,
    },
    include: {
      space: true,
    },
  });

  if (!membership) {
    throw createHttpError(403, 'You are not a member of this group');
  }

  return membership;
};

const toAdmin = (item: { userId: string; name: string }): SpaceAdmin => {
  return {
    userId: item.userId,
    name: item.name,
    role: 'admin',
  };
};

const buildAdminsResponse = async (
  groupId: string,
  userId: string,
): Promise<ApiResponse<ListGroupSignatoriesResponseDto>> => {
  await getGroupById(groupId);
  await requireMembership(groupId, userId);

  const adminMembers = await prisma.spaceMember.findMany({
    where: {
      spaceId: groupId,
      role: 'admin',
    },
    include: {
      user: true,
    },
  });
  const admins = adminMembers.map((member) =>
    toAdmin({
      userId: member.userId,
      name: member.user?.name ?? member.userId,
    }),
  );
  const remainingSlots = Math.max(0, 3 - admins.length);

  return {
    data: {
      admins,
      remainingSlots,
      signatories: admins,
    },
  };
};

const ensureOptionalFutureDateString = (value: unknown): string | undefined => {
  const deadline = ensureOptionalNonEmptyString(
    value,
    'deadline must be a non-empty ISO date string',
  );

  if (!deadline) {
    return undefined;
  }

  const parsedDate = new Date(deadline);

  if (Number.isNaN(parsedDate.getTime())) {
    throw createHttpError(400, 'deadline must be a valid ISO date string');
  }

  return parsedDate.toISOString();
};

const parseOptionalStringField = (
  value: unknown,
  message: string,
): { provided: boolean; value: string | undefined } => {
  if (value === undefined || value === null) {
    return { provided: false, value: undefined };
  }

  if (typeof value !== 'string') {
    throw createHttpError(400, message);
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
    const body = getObjectBody(req.body);
    const dto: CreateGroupRequestDto = {
      name: ensureNonEmptyString(body.name, 'name is required'),
      description: ensureOptionalNonEmptyString(
        body.description,
        'description must be a non-empty string',
      ),
      image: ensureOptionalNonEmptyString(
        body.image,
        'image must be a non-empty string',
      ),
      approvalThreshold:
        body.approvalThreshold === undefined || body.approvalThreshold === null
          ? 2
          : ensurePositiveInteger(
              body.approvalThreshold,
              'approvalThreshold must be a positive integer',
            ),
      targetAmount:
        body.targetAmount === undefined || body.targetAmount === null
          ? undefined
          : ensurePositiveNumber(
              body.targetAmount,
              'targetAmount must be a positive number',
            ),
      deadline: ensureOptionalFutureDateString(body.deadline),
    };

    const { space } = await createSpace({
      name: dto.name,
      description: dto.description,
      imageUrl: dto.image,
      targetAmount: dto.targetAmount,
      deadline: dto.deadline,
      approvalThreshold: dto.approvalThreshold,
      createdById: user.id,
    });

    const response: ApiResponse<CreateGroupResponseDto> = {
      data: {
        group: space,
        space,
      },
    };

    res.status(201).json(response);
  } catch (error) {
    next(error);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const user = await getCurrentUser(req.header('x-user-id'));
    const memberships = await prisma.spaceMember.findMany({
      where: {
        userId: user.id,
      },
      include: {
        space: true,
      },
    });
    const balancesBySpaceId = await getCompletedBalancesBySpaceIds(
      memberships.map((membership) => membership.space.id),
    );
    const visibleGroups = Array.from(
      new Map(
        memberships.map((membership) => [
          membership.space.id,
          mapSpaceToGroup(
            membership.space,
            balancesBySpaceId.get(membership.space.id) ?? 0,
          ),
        ]),
      ).values(),
    );

    const response: ApiResponse<ListGroupsResponseDto> = {
      data: {
        groups: visibleGroups,
        spaces: visibleGroups,
      },
    };

    res.json(response);
  } catch (error) {
    next(error);
  }
});

router.get('/:spaceId/transactions/summary', async (req: Request<SpaceParams>, res, next) => {
  try {
    const user = await getCurrentUser(req.header('x-user-id'));
    const { spaceId } = req.params;
    const group = await getGroupById(spaceId);
    await requireMembership(group.id, user.id);

    const response: ApiResponse<GetTransactionsSummaryResponseDto> = {
      data: await getTransactionsSummary(spaceId),
    };

    res.json(response);
  } catch (error) {
    next(error);
  }
});

router.post('/:spaceId/deposit', async (req: Request<SpaceParams>, res, next) => {
  try {
    const user = await getCurrentUser(req.header('x-user-id'));
    const { spaceId } = req.params;
    const group = await getGroupById(spaceId);
    await requireMembership(group.id, user.id);
    const body = getObjectBody(req.body);
    const amount = ensurePositiveNumber(body.amount, 'amount must be a positive number');
    const phoneNumber = ensureOptionalNonEmptyString(
      body.phoneNumber,
      'phoneNumber must be a non-empty string',
    );
    const externalName = ensureOptionalNonEmptyString(
      body.externalName,
      'externalName must be a non-empty string',
    );
    const deposit = await createDeposit(spaceId, user.id, amount, {
      phoneNumber,
      externalName,
      source: TransactionSource.MPESA_STK,
    });

    res.json({
      data: {
        success: true,
        deposit,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.post('/:spaceId/withdraw', async (req: Request<SpaceParams>, res, next) => {
  try {
    const user = await getCurrentUser(req.header('x-user-id'));
    const { spaceId } = req.params;
    const group = await getGroupById(spaceId);
    await requireMembership(group.id, user.id);
    const body = getObjectBody(req.body);
    const amount = ensurePositiveNumber(body.amount, 'amount must be a positive number');
    const reason = ensureOptionalNonEmptyString(
      body.reason,
      'reason must be a non-empty string',
    );
    const withdrawal = await createWithdrawal(spaceId, user.id, amount, reason);

    res.json({
      data: {
        success: true,
        withdrawal,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.post('/withdrawals/:withdrawalId/approve', async (req, res, next) => {
  try {
    const user = await getCurrentUser(req.header('x-user-id'));
    const withdrawal = await approveWithdrawal(req.params.withdrawalId, user.id);

    res.json({
      data: {
        success: true,
        withdrawal,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.post('/transactions/:transactionId/approve', async (req, res, next) => {
  try {
    const user = await getCurrentUser(req.header('x-user-id'));
    const withdrawal = await approveWithdrawal(req.params.transactionId, user.id);

    res.json({
      data: {
        success: true,
        withdrawal,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.post('/transactions/:transactionId/reject', async (req, res, next) => {
  try {
    const user = await getCurrentUser(req.header('x-user-id'));
    const withdrawal = await rejectWithdrawal(req.params.transactionId, user.id);

    res.json({
      data: {
        success: true,
        withdrawal,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.post('/transactions/:transactionId/execute', async (req, res, next) => {
  try {
    const user = await getCurrentUser(req.header('x-user-id'));
    const result = await executeWithdrawal(req.params.transactionId, user.id);

    res.json({
      data: {
        success: true,
        withdrawal: result.withdrawal,
        fee: result.fee,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.get('/:groupId', async (req: Request<GroupParams>, res, next) => {
  try {
    const user = await getCurrentUser(req.header('x-user-id'));
    await requireMembership(req.params.groupId, user.id);
    const group = await getGroupById(req.params.groupId);

    const response: ApiResponse<GetGroupResponseDto> = {
      data: {
        group,
        space: group,
      },
    };

    res.json(response);
  } catch (error) {
    next(error);
  }
});

router.patch('/:groupId', async (req: Request<GroupParams>, res, next) => {
  try {
    const user = await getCurrentUser(req.header('x-user-id'));
    const body = getObjectBody(req.body);
    const nameField = parseOptionalStringField(body.name, 'name must be a non-empty string');
    const descriptionField = parseOptionalStringField(
      body.description,
      'description must be a string',
    );
    const imageUrlField = parseOptionalStringField(
      body.imageUrl,
      'imageUrl must be a string',
    );
    const deadlineField = parseOptionalStringField(
      body.deadline,
      'deadline must be a valid ISO date string',
    );
    const dto: UpdateGroupRequestDto = {};

    if (nameField.provided) {
      dto.name = ensureNonEmptyString(nameField.value, 'name must be a non-empty string');
    }

    if (descriptionField.provided) {
      dto.description = descriptionField.value;
    }

    if (imageUrlField.provided) {
      dto.imageUrl = imageUrlField.value;
    }

    if (body.approvalThreshold !== undefined) {
      dto.approvalThreshold = ensurePositiveInteger(
        body.approvalThreshold,
        'approvalThreshold must be a positive integer',
      );
    }

    if (body.targetAmount !== undefined) {
      dto.targetAmount =
        body.targetAmount === null
          ? undefined
          : ensurePositiveNumber(body.targetAmount, 'targetAmount must be a positive number');
    }

    if (deadlineField.provided) {
      dto.deadline = deadlineField.value
        ? ensureOptionalFutureDateString(deadlineField.value)
        : undefined;
    }

    const group = await updateGroup(req.params.groupId, user.id, dto);

    const response: ApiResponse<UpdateGroupResponseDto> = {
      data: {
        group,
        space: group,
      },
    };

    res.json(response);
  } catch (error) {
    next(error);
  }
});

router.delete('/:groupId', async (req: Request<GroupParams>, res, next) => {
  try {
    const user = await getCurrentUser(req.header('x-user-id'));
    deleteGroup(req.params.groupId, user.id);

    const response: ApiResponse<DeleteGroupResponseDto> = {
      data: {
        success: true,
      },
    };

    res.json(response);
  } catch (error) {
    next(error);
  }
});

router.post('/:groupId/join', async (req: Request<GroupParams>, res, next) => {
  try {
    const user = await getCurrentUser(req.header('x-user-id'));
    const group = await getGroupById(req.params.groupId);
    const member = await joinSpace(group.id, user.id);

    const response: ApiResponse<JoinGroupResponseDto> = {
      data: {
        member,
      },
    };

    res.status(201).json(response);
  } catch (error) {
    next(error);
  }
});

router.delete('/:groupId/members/:memberId/leave', async (req: Request<GroupMemberParams>, res, next) => {
  try {
    const user = await getCurrentUser(req.header('x-user-id'));
    const member = await leaveSpace(req.params.groupId, user.id);

    const response: ApiResponse<LeaveGroupResponseDto> = {
      data: {
        member,
      },
    };

    res.json(response);
  } catch (error) {
    next(error);
  }
});

router.get('/:groupId/members', async (req: Request<GroupParams>, res, next) => {
  try {
    const user = await getCurrentUser(req.header('x-user-id'));
    const group = await getGroupById(req.params.groupId);
    await requireMembership(group.id, user.id);
    const members = await getSpaceMembers(group.id);
    const response: ApiResponse<ListGroupMembersResponseDto> = {
      data: {
        members,
      },
    };

    res.json(response);
  } catch (error) {
    next(error);
  }
});

router.get('/:groupId/signatories', async (req: Request<GroupParams>, res, next) => {
  try {
    const user = await getCurrentUser(req.header('x-user-id'));
    res.json(await buildAdminsResponse(req.params.groupId, user.id));
  } catch (error) {
    next(error);
  }
});

router.get('/:groupId/admins', async (req: Request<GroupParams>, res, next) => {
  try {
    const user = await getCurrentUser(req.header('x-user-id'));
    res.json(await buildAdminsResponse(req.params.groupId, user.id));
  } catch (error) {
    next(error);
  }
});

router.post('/:groupId/members/:memberId/promote', async (req: Request<GroupMemberParams>, res, next) => {
  try {
    const user = await getCurrentUser(req.header('x-user-id'));
    const member = await promoteMember(req.params.groupId, req.params.memberId, user.id);

    const response: ApiResponse<PromoteGroupMemberResponseDto> = {
      data: {
        member,
      },
    };

    res.json(response);
  } catch (error) {
    next(error);
  }
});

router.post('/:groupId/members/:memberId/revoke', async (req: Request<GroupMemberParams>, res, next) => {
  try {
    const user = await getCurrentUser(req.header('x-user-id'));
    const member = await revokeMember(req.params.groupId, req.params.memberId, user.id);

    const response: ApiResponse<RevokeGroupMemberResponseDto> = {
      data: {
        member,
      },
    };

    res.json(response);
  } catch (error) {
    next(error);
  }
});

export default router;

