import fs from 'fs';
import path from 'path';

import { prisma } from '../src/lib/prisma';

async function main() {
  const data = {
    users: await prisma.user.findMany(),
    spaces: await prisma.space.findMany(),
    spaceMembers: await prisma.spaceMember.findMany(),
    transactions: await prisma.transaction.findMany(),
    approvals: await prisma.withdrawalApproval.findMany(),
    notifications: await prisma.notification.findMany(),
    recipients: await prisma.notificationRecipient.findMany(),
  };

  const outputPath = path.resolve(__dirname, '../backup.json');
  fs.writeFileSync(outputPath, JSON.stringify(data, null, 2));
}

main().finally(() => prisma.$disconnect());
