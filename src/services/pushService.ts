import { prisma } from '../lib/prisma';

const EXPO_PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send';

export const sendPushToUser = async (
  userId: string,
  title: string,
  body: string,
): Promise<void> => {
  const devices = await prisma.device.findMany({
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

  const messages = devices.map((device: { token: string }) => ({
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
