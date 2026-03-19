import { GroupRole } from '../../../shared/contracts';
import { groupMembers, groups, users } from '../data/store';
import { createHttpError } from '../utils/http';

export const deleteCurrentUser = (userId: string): string => {
  const user = users.find((item) => item.id === userId);

  if (!user) {
    throw createHttpError(404, 'User not found');
  }

  const creatorGroups = groups.filter((group) => group.createdByUserId === userId);
  if (creatorGroups.length > 0) {
    throw createHttpError(409, 'User must delete their groups before deleting account');
  }

  const signatoryMemberships = groupMembers.filter(
    (member) => member.userId === userId && member.role === GroupRole.SIGNATORY,
  );
  if (signatoryMemberships.length > 0) {
    throw createHttpError(409, 'User must revoke signatory roles before deleting account');
  }

  const memberships = groupMembers.filter((member) => member.userId === userId);
  if (memberships.length > 0) {
    throw createHttpError(409, 'User must leave all groups before deleting account');
  }

  const index = users.findIndex((item) => item.id === userId);
  users.splice(index, 1);

  return userId;
};
