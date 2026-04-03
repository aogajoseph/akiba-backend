import { Request, Router } from 'express';

import {
  ApiResponse,
  CreateGroupRequestDto,
  CreateGroupResponseDto,
  DeleteGroupResponseDto,
  GetGroupResponseDto,
  GetTransactionsSummaryResponseDto,
  Group,
  GroupMember,
  JoinGroupResponseDto,
  LeaveGroupResponseDto,
  ListGroupMembersResponseDto,
  ListGroupSignatoriesResponseDto,
  ListGroupsResponseDto,
  PromoteGroupMemberResponseDto,
  RevokeGroupMemberResponseDto,
  SpaceAdmin,
  SpaceMember,
  UpdateGroupRequestDto,
  UpdateGroupResponseDto,
  User,
} from '../../../shared/contracts';
import { groupMembers, groups, users } from '../data/store';
import {
  createHttpError,
  ensureNonEmptyString,
  ensureOptionalNonEmptyString,
  ensurePositiveInteger,
  ensurePositiveNumber,
  getObjectBody,
} from '../utils/http';
import {
  approveWithdrawal,
  createDeposit,
  createSpace,
  createWithdrawal,
  deleteGroup,
  getTransactionsSummary,
  getSignatoryReport,
  joinGroup,
  leaveGroup,
  promoteMember,
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

const getCurrentUser = (headerValue: string | undefined): User => {
  const userId = ensureNonEmptyString(headerValue, 'x-user-id header is required');
  const user = users.find((item) => item.id === userId);

  if (!user) {
    throw createHttpError(404, 'User not found');
  }

  return user;
};

const getGroupById = (groupId: string): Group => {
  const group = groups.find((item) => item.id === groupId);

  if (!group) {
    throw createHttpError(404, 'Group not found');
  }

  return group;
};

const requireMembership = (groupId: string, userId: string): GroupMember => {
  const membership = groupMembers.find(
    (item) => item.groupId === groupId && item.userId === userId,
  );

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

const toSpaceMember = (member: GroupMember): SpaceMember => {
  const user = users.find((item) => item.id === member.userId);

  return {
    ...member,
    name: user?.name ?? member.userId,
  };
};

const buildAdminsResponse = (groupId: string, userId: string): ApiResponse<ListGroupSignatoriesResponseDto> => {
  const report = getSignatoryReport(groupId, userId);
  const admins = report.signatories.map(toAdmin);

  return {
    data: {
      admins,
      remainingSlots: report.remainingSlots,
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
    const user = getCurrentUser(req.header('x-user-id'));
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
      approvalThreshold: ensurePositiveInteger(
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

router.get('/', (req, res, next) => {
  try {
    const user = getCurrentUser(req.header('x-user-id'));
    const memberships = groupMembers.filter((item) => item.userId === user.id);
    const visibleGroups = groups.filter((group) =>
      memberships.some((membership) => membership.groupId === group.id),
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
    const user = getCurrentUser(req.header('x-user-id'));
    const { spaceId } = req.params;
    const group = getGroupById(spaceId);
    requireMembership(group.id, user.id);

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
    const user = getCurrentUser(req.header('x-user-id'));
    const { spaceId } = req.params;
    const group = getGroupById(spaceId);
    requireMembership(group.id, user.id);
    const body = getObjectBody(req.body);
    const amount = ensurePositiveNumber(body.amount, 'amount must be a positive number');
    const deposit = await createDeposit(spaceId, user.id, amount);

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
    const user = getCurrentUser(req.header('x-user-id'));
    const { spaceId } = req.params;
    const group = getGroupById(spaceId);
    requireMembership(group.id, user.id);
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
    const user = getCurrentUser(req.header('x-user-id'));
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

router.get('/:groupId', (req: Request<GroupParams>, res, next) => {
  try {
    const user = getCurrentUser(req.header('x-user-id'));
    const group = getGroupById(req.params.groupId);
    requireMembership(group.id, user.id);

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

router.patch('/:groupId', (req: Request<GroupParams>, res, next) => {
  try {
    const user = getCurrentUser(req.header('x-user-id'));
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

    const group = updateGroup(req.params.groupId, user.id, dto);

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

router.delete('/:groupId', (req: Request<GroupParams>, res, next) => {
  try {
    const user = getCurrentUser(req.header('x-user-id'));
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

router.post('/:groupId/join', (req: Request<GroupParams>, res, next) => {
  try {
    const user = getCurrentUser(req.header('x-user-id'));
    const group = getGroupById(req.params.groupId);

    const existingMembership = groupMembers.find(
      (item) => item.groupId === group.id && item.userId === user.id,
    );

    if (existingMembership) {
      throw createHttpError(409, 'User is already a member of this group');
    }

    const member = joinGroup(group.id, user.id);

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

router.delete('/:groupId/members/:memberId/leave', (req: Request<GroupMemberParams>, res, next) => {
  try {
    const user = getCurrentUser(req.header('x-user-id'));
    const member = leaveGroup(req.params.groupId, req.params.memberId, user.id);

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

router.get('/:groupId/members', (req: Request<GroupParams>, res, next) => {
  try {
    const user = getCurrentUser(req.header('x-user-id'));
    const group = getGroupById(req.params.groupId);
    requireMembership(group.id, user.id);

    const members = groupMembers
      .filter((item) => item.groupId === group.id)
      .map(toSpaceMember);
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

router.get('/:groupId/signatories', (req: Request<GroupParams>, res, next) => {
  try {
    const user = getCurrentUser(req.header('x-user-id'));
    res.json(buildAdminsResponse(req.params.groupId, user.id));
  } catch (error) {
    next(error);
  }
});

router.get('/:groupId/admins', (req: Request<GroupParams>, res, next) => {
  try {
    const user = getCurrentUser(req.header('x-user-id'));
    res.json(buildAdminsResponse(req.params.groupId, user.id));
  } catch (error) {
    next(error);
  }
});

router.post('/:groupId/members/:memberId/promote', (req: Request<GroupMemberParams>, res, next) => {
  try {
    const user = getCurrentUser(req.header('x-user-id'));
    const member = promoteMember(req.params.groupId, req.params.memberId, user.id);

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

router.post('/:groupId/members/:memberId/revoke', (req: Request<GroupMemberParams>, res, next) => {
  try {
    const user = getCurrentUser(req.header('x-user-id'));
    const member = revokeMember(req.params.groupId, req.params.memberId, user.id);

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

