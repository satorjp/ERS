-- CHECK constraints (Prisma schema cannot express these) — see database-design.md §5

ALTER TABLE "equipment"
  ADD CONSTRAINT "equipment_stock_quantity_non_negative"
  CHECK ("stock_quantity" >= 0);

ALTER TABLE "equipment_requests"
  ADD CONSTRAINT "equipment_requests_quantity_positive"
  CHECK ("quantity" > 0);

ALTER TABLE "equipment_requests"
  ADD CONSTRAINT "equipment_requests_reason_not_blank"
  CHECK (length(trim("reason")) > 0);

ALTER TABLE "equipment_requests"
  ADD CONSTRAINT "equipment_requests_reject_reason_rule"
  CHECK (
    ("status" = 'REJECTED' AND "reject_reason" IS NOT NULL AND length(trim("reject_reason")) > 0)
    OR ("status" <> 'REJECTED' AND "reject_reason" IS NULL)
  );

ALTER TABLE "equipment_requests"
  ADD CONSTRAINT "equipment_requests_review_fields_rule"
  CHECK (
    ("status" = 'PENDING'  AND "reviewed_by_id" IS NULL AND "approved_at" IS NULL AND "rejected_at" IS NULL)
    OR ("status" = 'APPROVED' AND "reviewed_by_id" IS NOT NULL AND "approved_at" IS NOT NULL AND "rejected_at" IS NULL)
    OR ("status" = 'REJECTED' AND "reviewed_by_id" IS NOT NULL AND "rejected_at" IS NOT NULL AND "approved_at" IS NULL)
  );

ALTER TABLE "request_attachments"
  ADD CONSTRAINT "request_attachments_size_non_negative"
  CHECK ("size_bytes" >= 0);

-- Trigram indexes for ILIKE '%keyword%' search — see database-design.md §6

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX "equipment_name_trgm_idx"  ON "equipment" USING GIN ("name" gin_trgm_ops);
CREATE INDEX "users_full_name_trgm_idx" ON "users"     USING GIN ("full_name" gin_trgm_ops);
