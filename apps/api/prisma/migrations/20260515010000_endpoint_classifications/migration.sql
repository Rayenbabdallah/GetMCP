-- CreateTable
CREATE TABLE "EndpointClassification" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "specHash" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "dataSensitivity" INTEGER NOT NULL,
    "mutationImpact" INTEGER NOT NULL,
    "hasTenantScope" BOOLEAN NOT NULL,
    "reversible" BOOLEAN NOT NULL,
    "exposeExternally" BOOLEAN NOT NULL,
    "reasoning" TEXT NOT NULL,
    "classifierSource" TEXT NOT NULL,
    "overrideExposeExternally" BOOLEAN,
    "overrideBy" TEXT,
    "overrideAt" TIMESTAMP(3),
    "overrideReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EndpointClassification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EndpointClassification_organizationId_specHash_idx" ON "EndpointClassification"("organizationId", "specHash");

-- CreateIndex
CREATE UNIQUE INDEX "EndpointClassification_organizationId_specHash_path_method_key" ON "EndpointClassification"("organizationId", "specHash", "path", "method");

-- AddForeignKey
ALTER TABLE "EndpointClassification" ADD CONSTRAINT "EndpointClassification_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
