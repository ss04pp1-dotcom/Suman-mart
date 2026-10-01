-- Round-4 audit hardening: one-time email OTP for guest checkout.

-- CreateTable
CREATE TABLE "GuestEmailOtp" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "consumedAt" DATETIME,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "GuestEmailOtp_email_createdAt_idx" ON "GuestEmailOtp"("email", "createdAt");
