import { Router } from 'express';

import {
  ApiResponse,
  CreateGroupRequestDto,
  CreateGroupResponseDto,
  GetGroupResponseDto,
  Group,
  GroupMember,
  GroupRole,
  JoinGroupRequestDto,
  JoinGroupResponseDto,
  ListGroupMembersResponseDto,
  ListGroupsResponseDto,
  User,
} from '../../../shared/contracts';
import { groupMembers, groups, users } from '../data/store';
import {
  createHttpError,
  createId,
  ensureNonEmptyString,
  ensurePositiveInteger,
  getObjectBody,
} from '../utils/http';

const router = Router();

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

router.post('/', (req, res, next) => {
  try {
    const user = getCurrentUser(req.header('x-user-id'));
    const body = getObjectBody(req.body);
    const dto: CreateGroupRequestDto = {
      name: ensureNonEmptyString(body.name, 'name is required'),
      approvalThreshold: ensurePositiveInteger(
        body.approvalThreshold,
        'approvalThreshold must be a positive integer',
      ),
    };

    const group: Group = {
      id: createId('group'),
      name: dto.name,
      createdByUserId: user.id,
      approvalThreshold: dto.approvalThreshold,
      createdAt: new Date().toISOString(),
    };

    const creatorMembership: GroupMember = {
      id: createId('member'),
      groupId: group.id,
      userId: user.id,
      role: GroupRole.SIGNATORY,
      joinedAt: new Date().toISOString(),
    };

    groups.push(group);
    groupMembers.push(creatorMembership);

    const response: ApiResponse<CreateGroupResponseDto> = {
      data: {
        group,
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
      },
    };

    res.json(response);
  } catch (error) {
    next(error);
  }
});

router.get('/:groupId', (req, res, next) => {
  try {
    const user = getCurrentUser(req.header('x-user-id'));
    const group = getGroupById(req.params.groupId);
    requireMembership(group.id, user.id);

    const response: ApiResponse<GetGroupResponseDto> = {
      data: {
        group,
      },
    };

    res.json(response);
  } catch (error) {
    next(error);
  }
});

router.post('/:groupId/join', (req, res, next) => {
  try {
    const user = getCurrentUser(req.header('x-user-id'));
    const group = getGroupById(req.params.groupId);
    const body = getObjectBody(req.body);
    const dto: JoinGroupRequestDto = {
      groupId: ensureNonEmptyString(body.groupId, 'groupId is required'),
    };

    if (dto.groupId !== group.id) {
      throw createHttpError(400, 'groupId in body must match the route parameter');
    }

    const existingMembership = groupMembers.find(
      (item) => item.groupId === group.id && item.userId === user.id,
    );

    if (existingMembership) {
      throw createHttpError(409, 'User is already a member of this group');
    }

    const member: GroupMember = {
      id: createId('member'),
      groupId: group.id,
      userId: user.id,
      role: GroupRole.MEMBER,
      joinedAt: new Date().toISOString(),
    };

    groupMembers.push(member);

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

router.get('/:groupId/members', (req, res, next) => {
  try {
    const user = getCurrentUser(req.header('x-user-id'));
    const group = getGroupById(req.params.groupId);
    requireMembership(group.id, user.id);

    const members = groupMembers.filter((item) => item.groupId === group.id);
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

export default router;
