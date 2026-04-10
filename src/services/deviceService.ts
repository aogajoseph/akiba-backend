import { prisma } from '../lib/prisma';

export const registerDeviceToken = async ({
  userId,
  token,
}: {
  userId: string;
  token: string;
}): Promise<{ success: true }> => {
  await prisma.device.upsert({
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
