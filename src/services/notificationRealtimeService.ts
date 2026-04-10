import crypto from 'crypto';
import http from 'http';
import { Duplex } from 'stream';

import { NotificationDTO, NotificationEvent } from '../../../shared/contracts';
import { getCurrentUserOrThrow } from '../utils/auth';

const NOTIFICATIONS_WS_PATH = '/notifications/ws';
const WS_MAGIC_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const connectedUsers = new Map<string, Set<Duplex>>();
const socketUsers = new Map<Duplex, string>();

const buildWebSocketAcceptKey = (webSocketKey: string): string => {
  return crypto.createHash('sha1').update(`${webSocketKey}${WS_MAGIC_GUID}`).digest('base64');
};

const encodeTextFrame = (payload: string): Buffer => {
  const message = Buffer.from(payload, 'utf8');
  const messageLength = message.length;

  if (messageLength < 126) {
    return Buffer.concat([Buffer.from([0x81, messageLength]), message]);
  }

  if (messageLength < 65536) {
    const header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(messageLength, 2);
    return Buffer.concat([header, message]);
  }

  const header = Buffer.alloc(10);
  header[0] = 0x81;
  header[1] = 127;
  header.writeBigUInt64BE(BigInt(messageLength), 2);
  return Buffer.concat([header, message]);
};

const closeSocket = (socket: Duplex, statusCode: number, reason: string): void => {
  if (socket.destroyed) {
    return;
  }

  socket.write(
    [
      'HTTP/1.1 ' + statusCode + ' ' + reason,
      'Connection: close',
      '',
      '',
    ].join('\r\n'),
  );
  socket.destroy();
};

const removeSocket = (socket: Duplex): void => {
  const userId = socketUsers.get(socket);

  if (!userId) {
    return;
  }

  socketUsers.delete(socket);

  const sockets = connectedUsers.get(userId);

  if (!sockets) {
    return;
  }

  sockets.delete(socket);

  if (sockets.size === 0) {
    connectedUsers.delete(userId);
  }
};

const registerSocket = (userId: string, socket: Duplex): void => {
  const sockets = connectedUsers.get(userId) ?? new Set<Duplex>();
  sockets.add(socket);
  connectedUsers.set(userId, sockets);
  socketUsers.set(socket, userId);

  socket.on('close', () => {
    removeSocket(socket);
  });

  socket.on('end', () => {
    removeSocket(socket);
  });

  socket.on('error', () => {
    removeSocket(socket);
  });
};

export const attachNotificationWebSocketServer = (server: http.Server): void => {
  server.on('upgrade', async (request, socket, head) => {
    try {
      const requestUrl = request.url ?? '';
      const url = new URL(requestUrl, 'http://localhost');

      if (url.pathname !== NOTIFICATIONS_WS_PATH) {
        return;
      }

      const userId = url.searchParams.get('userId')?.trim() ?? '';
      const webSocketKey = request.headers['sec-websocket-key'];

      if (!userId) {
        closeSocket(socket, 401, 'Unauthorized');
        return;
      }

      if (typeof webSocketKey !== 'string' || !webSocketKey.trim()) {
        closeSocket(socket, 400, 'Bad Request');
        return;
      }

      await getCurrentUserOrThrow(userId);

      if (head.length > 0) {
        socket.unshift(head);
      }

      const acceptKey = buildWebSocketAcceptKey(webSocketKey);

      socket.write(
        [
          'HTTP/1.1 101 Switching Protocols',
          'Upgrade: websocket',
          'Connection: Upgrade',
          `Sec-WebSocket-Accept: ${acceptKey}`,
          '',
          '',
        ].join('\r\n'),
      );

      registerSocket(userId, socket);
    } catch (_error) {
      closeSocket(socket, 401, 'Unauthorized');
    }
  });
};

export const broadcastNotificationCreated = ({
  userId,
  notification,
}: {
  userId: string;
  notification: NotificationDTO;
}): void => {
  const sockets = connectedUsers.get(userId);

  if (!sockets || sockets.size === 0) {
    return;
  }

  const event: NotificationEvent = {
    type: 'notification_created',
    payload: notification,
  };
  const frame = encodeTextFrame(JSON.stringify(event));

  sockets.forEach((socket) => {
    if (socket.destroyed || !socket.writable) {
      removeSocket(socket);
      return;
    }

    socket.write(frame, (error) => {
      if (error) {
        removeSocket(socket);
      }
    });
  });
};
