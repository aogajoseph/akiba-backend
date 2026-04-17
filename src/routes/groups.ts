import { Request, Router } from 'express';

import {
  ApiResponse,
  CreateGroupRequestDto,
  CreateGroupResponseDto,
  DeleteGroupResponseDto,
  GetSpaceNotificationPreferenceResponseDto,
  GetGroupResponseDto,
  GetSpaceSummaryResponseDto,
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
  UpdateSpaceNotificationPreferenceRequestDto,
  UpdateSpaceNotificationPreferenceResponseDto,
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
  getSpaceFinancialSnapshotBySpaceIds,
  getSpaceSummary,
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
}, financials?: {
  membersCount?: number;
  availableBalance?: number;
  pendingWithdrawalAmount?: number;
  reservedAmount?: number;
  totalBalance?: number;
  totalFees?: number;
}): Group => {
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

  const [financialsBySpaceId, membersCount] = await Promise.all([
    getSpaceFinancialSnapshotBySpaceIds([normalizedGroupId]),
    prisma.spaceMember.count({
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

const parseOptionalIsoDateQuery = (
  value: unknown,
  fieldName: string,
): Date | undefined => {
  const rawValue = ensureOptionalNonEmptyString(
    value,
    `${fieldName} must be a non-empty ISO date string`,
  );

  if (!rawValue) {
    return undefined;
  }

  const parsedDate = new Date(rawValue);

  if (Number.isNaN(parsedDate.getTime())) {
    throw createHttpError(400, `${fieldName} must be a valid ISO date string`);
  }

  return parsedDate;
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

const ensureOptionalHttpUrlString = (
  value: string | undefined,
  fieldName: string,
): string | undefined => {
  if (!value) {
    return undefined;
  }

  let parsedUrl: URL;

  try {
    parsedUrl = new URL(value);
  } catch {
    throw createHttpError(400, `${fieldName} must be a valid URL`);
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw createHttpError(400, `${fieldName} must be an http or https URL`);
  }

  return parsedUrl.toString();
};

const ensureBooleanField = (value: unknown, fieldName: string): boolean => {
  if (typeof value !== 'boolean') {
    throw createHttpError(400, `${fieldName} must be a boolean`);
  }

  return value;
};

router.post('/', async (req, res, next) => {
  try {
    const user = await getCurrentUser(req.header('x-user-id'));
    const body = getObjectBody(req.body);
    const imageUrl = ensureOptionalHttpUrlString(
      ensureOptionalNonEmptyString(
        body.imageUrl ?? body.image,
        'imageUrl must be a non-empty string',
      ),
      'imageUrl',
    );
    const dto: CreateGroupRequestDto = {
      name: ensureNonEmptyString(body.name, 'name is required'),
      description: ensureOptionalNonEmptyString(
        body.description,
        'description must be a non-empty string',
      ),
      image: imageUrl,
      imageUrl,
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
      imageUrl: dto.imageUrl ?? dto.image,
      targetAmount: dto.targetAmount,
      deadline: dto.deadline,
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
    const spaceIds = memberships.map((membership) => membership.space.id);
    const [financialsBySpaceId, memberCounts] = await Promise.all([
      getSpaceFinancialSnapshotBySpaceIds(spaceIds),
      prisma.spaceMember.groupBy({
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
    const membersCountBySpaceId = new Map(
      memberCounts.map((item) => [item.spaceId, item._count._all]),
    );
    const visibleGroups = Array.from(
      new Map(
        memberships.map((membership) => [
          membership.space.id,
          mapSpaceToGroup(
            membership.space,
            {
              ...financialsBySpaceId.get(membership.space.id),
              membersCount: membersCountBySpaceId.get(membership.space.id),
            },
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

router.get('/:spaceId/summary', async (req: Request<SpaceParams>, res, next) => {
  try {
    const user = await getCurrentUser(req.header('x-user-id'));
    const { spaceId } = req.params;
    const from = parseOptionalIsoDateQuery(req.query.from, 'from');
    const to = parseOptionalIsoDateQuery(req.query.to, 'to');

    if (from && to && from > to) {
      throw createHttpError(400, 'from must be earlier than or equal to to');
    }

    await getGroupById(spaceId);
    await requireMembership(spaceId, user.id);

    const response: ApiResponse<GetSpaceSummaryResponseDto> = {
      data: await getSpaceSummary(spaceId, { from, to }),
    };

    res.json(response);
  } catch (error) {
    next(error);
  }
});

router.get('/:spaceId/notification-preference', async (req: Request<SpaceParams>, res, next) => {
  try {
    const user = await getCurrentUser(req.header('x-user-id'));
    const { spaceId } = req.params;

    await getGroupById(spaceId);
    await requireMembership(spaceId, user.id);

    const preference = await prisma.spaceNotificationPreference.findUnique({
      where: {
        userId_spaceId: {
          userId: user.id,
          spaceId,
        },
      },
      select: {
        muted: true,
      },
    });

    const response: ApiResponse<GetSpaceNotificationPreferenceResponseDto> = {
      data: {
        muted: preference?.muted ?? false,
      },
    };

    console.log('RETURN MUTED:', preference?.muted ?? false);

    res.json(response);
  } catch (error) {
    next(error);
  }
});

router.patch('/:spaceId/notification-preference', async (req: Request<SpaceParams>, res, next) => {
  try {
    const user = await getCurrentUser(req.header('x-user-id'));
    const { spaceId } = req.params;
    const body = getObjectBody(req.body);

    await getGroupById(spaceId);
    await requireMembership(spaceId, user.id);

    const muted = ensureBooleanField(
      (body as Partial<UpdateSpaceNotificationPreferenceRequestDto>).muted,
      'muted',
    );

    console.log('SAVE MUTED:', muted);

    const preference = await prisma.spaceNotificationPreference.upsert({
      where: {
        userId_spaceId: {
          userId: user.id,
          spaceId,
        },
      },
      update: {
        muted,
      },
      create: {
        userId: user.id,
        spaceId,
        muted,
      },
      select: {
        muted: true,
      },
    });

    const response: ApiResponse<UpdateSpaceNotificationPreferenceResponseDto> = {
      data: {
        muted: preference.muted,
      },
    };

    console.log('RETURN MUTED:', preference.muted);

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
    const bodySpaceId = ensureNonEmptyString(body.spaceId, 'spaceId is required');
    const amount = ensurePositiveNumber(body.amount, 'amount must be a positive number');
    const source = ensureNonEmptyString(body.source, 'source is required');
    const phoneNumber = ensureOptionalNonEmptyString(
      body.phoneNumber,
      'phoneNumber must be a non-empty string',
    );

    if (bodySpaceId !== spaceId) {
      throw createHttpError(400, 'spaceId does not match route parameter');
    }

    const deposit = await createDeposit({
      amount,
      phoneNumber,
      source: source as TransactionSource,
      spaceId,
      userId: user.id,
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
    const reason = ensureNonEmptyString(body.reason, 'reason must be a non-empty string');
    const recipientPhoneNumber = ensureNonEmptyString(
      body.recipientPhoneNumber,
      'recipientPhoneNumber must be a non-empty string',
    );
    const recipientName = ensureNonEmptyString(
      body.recipientName,
      'recipientName must be a non-empty string',
    );
    const withdrawal = await createWithdrawal(spaceId, user.id, amount, {
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
      dto.imageUrl = ensureOptionalHttpUrlString(imageUrlField.value, 'imageUrl');
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
    await deleteGroup(req.params.groupId, user.id);

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

