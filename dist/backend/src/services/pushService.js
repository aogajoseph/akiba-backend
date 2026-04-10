"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendPushToUser = void 0;
const prisma_1 = require("../lib/prisma");
const EXPO_PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send';
const sendPushToUser = async (userId, title, body) => {
    const devices = await prisma_1.prisma.device.findMany({
        where: {
            userId,
        },
        select: {
            token: true,
        },
    });
    if (devices.length === 0) {
        return;
    }
    const messages = devices.map((device) => ({
        to: device.token,
        sound: 'default',
        title,
        body,
    }));
    const response = await fetch(EXPO_PUSH_ENDPOINT, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(messages),
    });
    if (!response.ok) {
        throw new Error(`Expo push request failed with status ${response.status}`);
    }
};
exports.sendPushToUser = sendPushToUser;
