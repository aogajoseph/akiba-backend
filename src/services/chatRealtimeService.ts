import { Server } from 'socket.io';

import { Message, TypingUser } from '../../../shared/contracts';

type MessageCreatedPayload = {
  message: Message;
  spaceId: string;
};

type MessageDeletedPayload = {
  messageId: string;
  spaceId: string;
};

type ReactionUpdatedPayload = {
  message: Message;
  spaceId: string;
};

type TypingPayload = {
  spaceId: string;
  users: TypingUser[];
};

let chatIo: Server | null = null;

export const attachChatSocketServer = (io: Server): void => {
  chatIo = io;
};

const emitToSpace = <TPayload>(spaceId: string, event: string, payload: TPayload): void => {
  chatIo?.to(spaceId).emit(event, payload);
};

export const emitMessageCreated = (payload: MessageCreatedPayload): void => {
  emitToSpace(payload.spaceId, 'message_created', payload);
};

export const emitMessageDeleted = (payload: MessageDeletedPayload): void => {
  emitToSpace(payload.spaceId, 'message_deleted', payload);
};

export const emitReactionUpdated = (payload: ReactionUpdatedPayload): void => {
  emitToSpace(payload.spaceId, 'reaction_updated', payload);
};

export const emitTypingUpdate = (payload: TypingPayload): void => {
  emitToSpace(payload.spaceId, 'typing', payload);
};
