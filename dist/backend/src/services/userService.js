"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteCurrentUser = void 0;
const contracts_1 = require("../../../shared/contracts");
const store_1 = require("../data/store");
const prisma_1 = require("../lib/prisma");
const http_1 = require("../utils/http");
const deleteCurrentUser = async (userId) => {
    const user = await prisma_1.prisma.user.findUnique({
        where: {
            id: userId,
        },
    });
    if (!user) {
        throw (0, http_1.createHttpError)(404, 'User not found');
    }
    const creatorGroups = store_1.groups.filter((group) => group.createdByUserId === userId);
    if (creatorGroups.length > 0) {
        throw (0, http_1.createHttpError)(409, 'User must delete their groups before deleting account');
    }
    const signatoryMemberships = store_1.groupMembers.filter((member) => member.userId === userId && member.role === contracts_1.GroupRole.SIGNATORY);
    if (signatoryMemberships.length > 0) {
        throw (0, http_1.createHttpError)(409, 'User must revoke signatory roles before deleting account');
    }
    const memberships = store_1.groupMembers.filter((member) => member.userId === userId);
    if (memberships.length > 0) {
        throw (0, http_1.createHttpError)(409, 'User must leave all groups before deleting account');
    }
    await prisma_1.prisma.user.delete({
        where: {
            id: userId,
        },
    });
    const index = store_1.users.findIndex((item) => item.id === userId);
    if (index >= 0) {
        store_1.users.splice(index, 1);
    }
    return userId;
};
exports.deleteCurrentUser = deleteCurrentUser;
