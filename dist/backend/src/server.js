"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const express_1 = __importDefault(require("express"));
const path_1 = __importDefault(require("path"));
const approvals_1 = __importDefault(require("./routes/approvals"));
const auth_1 = __importDefault(require("./routes/auth"));
const groups_1 = __importDefault(require("./routes/groups"));
const messages_1 = __importDefault(require("./routes/messages"));
const typing_1 = __importDefault(require("./routes/typing"));
const transactions_1 = __importDefault(require("./routes/transactions"));
const users_1 = __importDefault(require("./routes/users"));
const http_1 = require("./utils/http");
dotenv_1.default.config();
const app = (0, express_1.default)();
const port = Number(process.env.PORT ?? 4000);
app.use((0, cors_1.default)());
app.use(express_1.default.json());
app.use('/media', express_1.default.static(path_1.default.join(process.cwd(), 'uploads')));
app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
});
app.use('/auth', auth_1.default);
app.use('/users', users_1.default);
app.use('/groups', groups_1.default);
app.use('/spaces', groups_1.default);
app.use('/groups/:groupId/transactions', transactions_1.default);
app.use('/groups/:groupId/transactions/:transactionId/approvals', approvals_1.default);
app.use('/groups/:groupId/messages', messages_1.default);
app.use('/spaces/:groupId/messages', messages_1.default);
app.use('/groups/:groupId/typing', typing_1.default);
app.use('/spaces/:spaceId/typing', typing_1.default);
app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
});
app.use(http_1.errorHandler);
app.listen(port, () => {
    console.log(`Akiba backend listening on port ${port}`);
});
