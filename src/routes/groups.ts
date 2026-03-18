import { Router } from 'express';

import {
  ApiResponse,
  CreateGroupResponseDto,
  GetGroupResponseDto,
  JoinGroupResponseDto,
  ListGroupMembersResponseDto,
  ListGroupsResponseDto,
} from '../../../shared/contracts';
import { groupMembers, groups } from '../data/store';

const router = Router();

router.post('/', (_req, res) => {
  const response: ApiResponse<CreateGroupResponseDto> = {
    data: {
      group: groups[0],
    },
  };

  res.status(201).json(response);
});

router.get('/', (_req, res) => {
  const response: ApiResponse<ListGroupsResponseDto> = {
    data: {
      groups,
    },
  };

  res.json(response);
});

router.get('/:groupId', (req, res) => {
  const group = groups.find((item) => item.id === req.params.groupId) ?? groups[0];
  const response: ApiResponse<GetGroupResponseDto> = {
    data: {
      group,
    },
  };

  res.json(response);
});

router.post('/:groupId/join', (req, res) => {
  const member = groupMembers.find((item) => item.groupId === req.params.groupId) ?? groupMembers[0];
  const response: ApiResponse<JoinGroupResponseDto> = {
    data: {
      member,
    },
  };

  res.status(201).json(response);
});

router.get('/:groupId/members', (req, res) => {
  const members = groupMembers.filter((item) => item.groupId === req.params.groupId);
  const response: ApiResponse<ListGroupMembersResponseDto> = {
    data: {
      members: members.length > 0 ? members : groupMembers,
    },
  };

  res.json(response);
});

export default router;
