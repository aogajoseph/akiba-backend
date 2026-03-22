import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import path from 'path';

import approvalsRouter from './routes/approvals';
import authRouter from './routes/auth';
import groupsRouter from './routes/groups';
import messagesRouter from './routes/messages';
import typingRouter from './routes/typing';
import transactionsRouter from './routes/transactions';
import usersRouter from './routes/users';
import { errorHandler } from './utils/http';

dotenv.config();

const app = express();
const port = Number(process.env.PORT ?? 4000);

app.use(cors());
app.use(express.json());
app.use('/media', express.static(path.join(process.cwd(), 'uploads')));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use('/auth', authRouter);
app.use('/users', usersRouter);
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

app.listen(port, () => {
  console.log(`Akiba backend listening on port ${port}`);
});

