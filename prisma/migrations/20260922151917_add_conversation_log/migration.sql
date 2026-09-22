-- CreateTable
CREATE TABLE "ConversationLog" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userMessage" TEXT NOT NULL,
    "assistantMessage" TEXT NOT NULL,
    "transcript" JSONB NOT NULL,

    CONSTRAINT "ConversationLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConversationLog_patientId_createdAt_idx" ON "ConversationLog"("patientId", "createdAt");

-- AddForeignKey
ALTER TABLE "ConversationLog" ADD CONSTRAINT "ConversationLog_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
