import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import http from 'http';
import path from 'path';
import { Server } from 'socket.io';

import approvalsRouter from './routes/approvals';
import authRouter from './routes/auth';
import groupsRouter from './routes/groups';
import messagesRouter from './routes/messages';
import notificationsRouter from './routes/notifications';
import paymentsRouter from './routes/payments';
import typingRouter from './routes/typing';
import transactionsRouter from './routes/transactions';
import usersRouter from './routes/users';
import { attachNotificationWebSocketServer } from './services/notificationRealtimeService';
import { errorHandler } from './utils/http';

dotenv.config();

const app = express();
const port = Number(process.env.PORT ?? 4000);
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});
const spacePresence = new Map<string, Set<string>>();
const socketPresence = new Map<string, { spaceId: string; userId: string }>();
const spaceUserConnectionCounts = new Map<string, number>();

const getPresenceKey = (spaceId: string, userId: string): string => `${spaceId}:${userId}`;

const emitPresenceUpdate = (spaceId: string): void => {
  io.to(spaceId).emit('presence_update', {
    spaceId,
    onlineCount: spacePresence.get(spaceId)?.size ?? 0,
  });
};

const removeSocketPresence = (socketId: string): void => {
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
  } else {
    spaceUserConnectionCounts.set(presenceKey, currentCount - 1);
  }

  emitPresenceUpdate(presence.spaceId);
};

io.on('connection', (socket) => {
  socket.on('join_space', (payload: { spaceId?: string; userId?: string }) => {
    const spaceId =
      typeof payload?.spaceId === 'string' ? payload.spaceId.trim() : '';
    const userId =
      typeof payload?.userId === 'string' ? payload.userId.trim() : '';

    if (!spaceId || !userId) {
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
      users = new Set<string>();
      spacePresence.set(spaceId, users);
    }

    users.add(userId);
    emitPresenceUpdate(spaceId);
  });

  socket.on('disconnect', () => {
    removeSocketPresence(socket.id);
  });
});

attachNotificationWebSocketServer(httpServer);

app.use(cors());
app.use(express.json());
app.use('/media', express.static(path.join(process.cwd(), 'uploads')));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use('/auth', authRouter);
app.use('/users', usersRouter);
app.use('/notifications', notificationsRouter);
app.use('/payments', paymentsRouter);
app.use('/groups', groupsRouter);
app.use('/spaces', groupsRouter);
app.use('/groups/:groupId/transactions', transactionsRouter);
app.use('/groups/:groupId/transactions/:transactionId/approvals', approvalsRouter);
app.use('/groups/:groupId/messages', messagesRouter);
app.use('/spaces/:groupId/messages', messagesRouter);
app.use('/groups/:groupId/typing', typingRouter);
app.use('/spaces/:spaceId/typing', typingRouter);

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use(errorHandler);

httpServer.listen(port, () => {
  console.log(`Akiba backend listening on port ${port}`);
});

