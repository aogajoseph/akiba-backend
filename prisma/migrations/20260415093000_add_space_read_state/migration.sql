-- CreateTable
CREATE TABLE "SpaceReadState" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "lastReadAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpaceReadState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SpaceReadState_userId_spaceId_key" ON "SpaceReadState"("userId", "spaceId");

-- CreateIndex
CREATE INDEX "SpaceReadState_spaceId_lastReadAt_idx" ON "SpaceReadState"("spaceId", "lastReadAt");

-- CreateIndex
CREATE INDEX "SpaceReadState_userId_lastReadAt_idx" ON "SpaceReadState"("userId", "lastReadAt");

-- AddForeignKey
ALTER TABLE "SpaceReadState" ADD CONSTRAINT "SpaceReadState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpaceReadState" ADD CONSTRAINT "SpaceReadState_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
