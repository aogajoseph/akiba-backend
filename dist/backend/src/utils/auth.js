"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCurrentUserOrThrow = void 0;
const store_1 = require("../data/store");
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
const syncUserCache = (user) => {
    const existingIndex = store_1.users.findIndex((item) => item.id === user.id);
    if (existingIndex >= 0) {
        store_1.users[existingIndex] = user;
        return;
    }
    store_1.users.push(user);
};
const getCurrentUserOrThrow = async (userId) => {
    const dbUser = await prisma_1.prisma.user.findUnique({
        where: {
            id: userId,
        },
    });
    if (!dbUser) {
        throw (0, http_1.createHttpError)(404, 'User not found');
    }
    const user = mapDbUserToContractUser(dbUser);
    syncUserCache(user);
    return user;
};
exports.getCurrentUserOrThrow = getCurrentUserOrThrow;
