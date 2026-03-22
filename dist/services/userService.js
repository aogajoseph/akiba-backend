"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteCurrentUser = void 0;
const contracts_1 = require("../../../shared/contracts");
const store_1 = require("../data/store");
const http_1 = require("../utils/http");
const deleteCurrentUser = (userId) => {
    const user = store_1.users.find((item) => item.id === userId);
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
    const index = store_1.users.findIndex((item) => item.id === userId);
    store_1.users.splice(index, 1);
    return userId;
};
exports.deleteCurrentUser = deleteCurrentUser;
