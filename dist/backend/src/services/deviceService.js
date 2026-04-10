"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerDeviceToken = void 0;
const prisma_1 = require("../lib/prisma");
const registerDeviceToken = async ({ userId, token, }) => {
    await prisma_1.prisma.device.upsert({
        where: {
            token,
        },
        update: {
            userId,
        },
        create: {
            userId,
            token,
        },
    });
    return { success: true };
};
exports.registerDeviceToken = registerDeviceToken;
