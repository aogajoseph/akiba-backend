"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const express_1 = __importDefault(require("express"));
const http_1 = __importDefault(require("http"));
const path_1 = __importDefault(require("path"));
const socket_io_1 = require("socket.io");
const approvals_1 = __importDefault(require("./routes/approvals"));
const auth_1 = __importDefault(require("./routes/auth"));
const devices_1 = __importDefault(require("./routes/devices"));
const groups_1 = __importDefault(require("./routes/groups"));
const messages_1 = __importDefault(require("./routes/messages"));
const notifications_1 = __importDefault(require("./routes/notifications"));
const payments_1 = __importDefault(require("./routes/payments"));
const typing_1 = __importDefault(require("./routes/typing"));
const transactions_1 = __importDefault(require("./routes/transactions"));
const users_1 = __importDefault(require("./routes/users"));
const chatRealtimeService_1 = require("./services/chatRealtimeService");
const prisma_1 = require("./lib/prisma");
const notificationRealtimeService_1 = require("./services/notificationRealtimeService");
const http_2 = require("./utils/http");
dotenv_1.default.config();
const app = (0, express_1.default)();
const port = Number(process.env.PORT ?? 4000);
const httpServer = http_1.default.createServer(app);
const io = new socket_io_1.Server(httpServer, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST'],
    },
});
const spacePresence = new Map();
const socketPresence = new Map();
const spaceUserConnectionCounts = new Map();
const getPresenceKey = (spaceId, userId) => `${spaceId}:${userId}`;
const emitPresenceUpdate = (spaceId) => {
    io.to(spaceId).emit('presence_update', {
        spaceId,
        onlineCount: spacePresence.get(spaceId)?.size ?? 0,
    });
};
const removeSocketPresence = (socketId) => {
    const presence = socketPresence.get(socketId);
    if (!presence) {
        return;
    }
    socketPresence.delete(socketId);
    const presenceKey = getPresenceKey(presence.spaceId, presence.userId);
    const currentCount = spaceUserConnectionCounts.get(presenceKey) ?? 0;
    if (currentCount <= 1) {
        spaceUserConnectionCounts.delete(presenceKey);
        const users = spacePresence.get(presence.spaceId);
        if (users) {
            users.delete(presence.userId);
            if (users.size === 0) {
                spacePresence.delete(presence.spaceId);
            }
        }
    }
    else {
        spaceUserConnectionCounts.set(presenceKey, currentCount - 1);
    }
    emitPresenceUpdate(presence.spaceId);
};
io.on('connection', (socket) => {
    socket.on('join_space', async (payload) => {
        const spaceId = typeof payload?.spaceId === 'string' ? payload.spaceId.trim() : '';
        const userId = typeof payload?.userId === 'string' ? payload.userId.trim() : '';
        if (!spaceId || !userId) {
            return;
        }
        const membership = await prisma_1.prisma.spaceMember.findFirst({
            where: {
                spaceId,
                userId,
            },
        });
        if (!membership) {
            return;
        }
        const previousPresence = socketPresence.get(socket.id);
        if (previousPresence) {
            socket.leave(previousPresence.spaceId);
            removeSocketPresence(socket.id);
        }
        socket.join(spaceId);
        socketPresence.set(socket.id, { spaceId, userId });
        const presenceKey = getPresenceKey(spaceId, userId);
        const currentCount = spaceUserConnectionCounts.get(presenceKey) ?? 0;
        spaceUserConnectionCounts.set(presenceKey, currentCount + 1);
        let users = spacePresence.get(spaceId);
        if (!users) {
            users = new Set();
            spacePresence.set(spaceId, users);
        }
        users.add(userId);
        emitPresenceUpdate(spaceId);
    });
    socket.on('disconnect', () => {
        removeSocketPresence(socket.id);
    });
});
(0, chatRealtimeService_1.attachChatSocketServer)(io);
(0, notificationRealtimeService_1.attachNotificationWebSocketServer)(httpServer);
app.use((0, cors_1.default)());
app.use(express_1.default.json());
app.use('/media', express_1.default.static(path_1.default.join(process.cwd(), 'uploads')));
app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
});
app.use('/auth', auth_1.default);
app.use('/devices', devices_1.default);
app.use('/users', users_1.default);
app.use('/notifications', notifications_1.default);
app.use('/payments', payments_1.default);
app.use('/groups', groups_1.default);
app.use('/spaces', groups_1.default);
app.use('/groups/:groupId/transactions', transactions_1.default);
app.use('/groups/:groupId/transactions/:transactionId/approvals', approvals_1.default);
app.use('/groups/:groupId/messages', messages_1.default);
app.use('/spaces/:spaceId/messages', messages_1.default);
app.use('/groups/:groupId/typing', typing_1.default);
app.use('/spaces/:spaceId/typing', typing_1.default);
app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
});
app.use(http_2.errorHandler);
httpServer.listen(port, () => {
    console.log(`Akiba backend listening on port ${port}`);
});
