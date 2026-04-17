CREATE TABLE "SpaceNotificationPreference" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "spaceId" TEXT NOT NULL,
  "muted" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SpaceNotificationPreference_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SpaceNotificationPreference_userId_spaceId_key"
ON "SpaceNotificationPreference"("userId", "spaceId");

CREATE INDEX "SpaceNotificationPreference_spaceId_muted_idx"
ON "SpaceNotificationPreference"("spaceId", "muted");

CREATE INDEX "SpaceNotificationPreference_userId_muted_idx"
ON "SpaceNotificationPreference"("userId", "muted");

ALTER TABLE "SpaceNotificationPreference"
ADD CONSTRAINT "SpaceNotificationPreference_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SpaceNotificationPreference"
ADD CONSTRAINT "SpaceNotificationPreference_spaceId_fkey"
FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
