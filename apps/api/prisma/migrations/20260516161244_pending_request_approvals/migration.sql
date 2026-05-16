-- CreateTable
CREATE TABLE "PendingRequestApproval" (
    "id" TEXT NOT NULL,
    "pendingRequestId" TEXT NOT NULL,
    "approverSlackUserId" TEXT NOT NULL,
    "approverSlackUserName" TEXT NOT NULL,
    "justification" TEXT,
    "decision" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PendingRequestApproval_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PendingRequestApproval_pendingRequestId_idx" ON "PendingRequestApproval"("pendingRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "PendingRequestApproval_pendingRequestId_approverSlackUserId_key" ON "PendingRequestApproval"("pendingRequestId", "approverSlackUserId");

-- AddForeignKey
ALTER TABLE "PendingRequestApproval" ADD CONSTRAINT "PendingRequestApproval_pendingRequestId_fkey" FOREIGN KEY ("pendingRequestId") REFERENCES "PendingRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
