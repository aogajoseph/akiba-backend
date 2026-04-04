"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getUsersByIds = exports.getUserByPhoneNumber = exports.getCurrentUserOrThrow = exports.mapDbUserToContractUser = void 0;
const prisma_1 = require("../lib/prisma");
const http_1 = require("./http");
const mapDbUserToContractUser = (user) => {
    return {
        id: user.id,
        name: user.name ?? '',
        phoneNumber: user.phone ?? '',
        createdAt: user.createdAt.toISOString(),
    };
};
exports.mapDbUserToContractUser = mapDbUserToContractUser;
const getCurrentUserOrThrow = async (userId) => {
    const dbUser = await prisma_1.prisma.user.findUnique({
        where: {
            id: userId,
        },
    });
    if (!dbUser) {
        throw (0, http_1.createHttpError)(404, 'User not found');
    }
    return (0, exports.mapDbUserToContractUser)(dbUser);
};
exports.getCurrentUserOrThrow = getCurrentUserOrThrow;
const getUserByPhoneNumber = async (phoneNumber) => {
    const dbUser = await prisma_1.prisma.user.findUnique({
        where: {
            phone: phoneNumber,
        },
    });
    if (!dbUser) {
        return null;
    }
    return (0, exports.mapDbUserToContractUser)(dbUser);
};
exports.getUserByPhoneNumber = getUserByPhoneNumber;
const getUsersByIds = async (userIds) => {
    const uniqueUserIds = Array.from(new Set(userIds.filter(Boolean)));
    if (uniqueUserIds.length === 0) {
        return new Map();
    }
    const dbUsers = await prisma_1.prisma.user.findMany({
        where: {
            id: {
                in: uniqueUserIds,
            },
        },
    });
    return dbUsers.reduce((userMap, dbUser) => {
        const user = (0, exports.mapDbUserToContractUser)(dbUser);
        userMap.set(user.id, user);
        return userMap;
    }, new Map());
};
exports.getUsersByIds = getUsersByIds;
