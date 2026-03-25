import { Request, Router } from 'express';

import {
  ApiResponse,
  CreateGroupRequestDto,
  CreateGroupResponseDto,
  DeleteGroupResponseDto,
  GetGroupResponseDto,
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
  User,
} from '../../../shared/contracts';
import { groupMembers, groups, users } from '../data/store';
import {
  createHttpError,
  ensureNonEmptyString,
  ensureOptionalNonEmptyString,
  ensurePositiveInteger,
  getObjectBody,
} from '../utils/http';
import {
  createGroup,
  deleteGroup,
  getSignatoryReport,
  joinGroup,
  leaveGroup,
  promoteMember,
  revokeMember,
} from '../services/groupService';

const router = Router();

type GroupParams = {
  groupId: string;
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

router.post('/', (req, res, next) => {
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
    };

    const { group } = createGroup(user.id, dto);

    const response: ApiResponse<CreateGroupResponseDto> = {
      data: {
        group,
        space: group,
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

