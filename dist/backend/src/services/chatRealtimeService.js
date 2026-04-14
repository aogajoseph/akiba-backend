"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.emitTypingUpdate = exports.emitReactionUpdated = exports.emitMessageDeleted = exports.emitMessageCreated = exports.attachChatSocketServer = void 0;
let chatIo = null;
const attachChatSocketServer = (io) => {
    chatIo = io;
};
exports.attachChatSocketServer = attachChatSocketServer;
const emitToSpace = (spaceId, event, payload) => {
    chatIo?.to(spaceId).emit(event, payload);
};
const emitMessageCreated = (payload) => {
    emitToSpace(payload.spaceId, 'message_created', payload);
};
exports.emitMessageCreated = emitMessageCreated;
const emitMessageDeleted = (payload) => {
    emitToSpace(payload.spaceId, 'message_deleted', payload);
};
exports.emitMessageDeleted = emitMessageDeleted;
const emitReactionUpdated = (payload) => {
    emitToSpace(payload.spaceId, 'reaction_updated', payload);
};
exports.emitReactionUpdated = emitReactionUpdated;
const emitTypingUpdate = (payload) => {
    emitToSpace(payload.spaceId, 'typing', payload);
};
exports.emitTypingUpdate = emitTypingUpdate;
