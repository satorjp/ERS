-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('RESTOCK', 'ADJUST', 'REQUEST_APPROVED', 'RETURN');

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" UUID NOT NULL,
    "equipment_id" UUID NOT NULL,
    "type" "StockMovementType" NOT NULL,
    "quantity_change" INTEGER NOT NULL,
    "balance_after" INTEGER NOT NULL,
    "actor_id" UUID NOT NULL,
    "request_id" UUID,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stock_movements_equipment_id_created_at_idx" ON "stock_movements"("equipment_id", "created_at");

-- CreateIndex
CREATE INDEX "stock_movements_request_id_idx" ON "stock_movements"("request_id");

-- CreateIndex
CREATE INDEX "stock_movements_type_created_at_idx" ON "stock_movements"("type", "created_at");

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_equipment_id_fkey" FOREIGN KEY ("equipment_id") REFERENCES "equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "equipment_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Ledger rules (database-level, in addition to service validation)
ALTER TABLE "stock_movements"
  ADD CONSTRAINT "stock_movements_quantity_change_non_zero"
  CHECK ("quantity_change" <> 0);

ALTER TABLE "stock_movements"
  ADD CONSTRAINT "stock_movements_balance_after_non_negative"
  CHECK ("balance_after" >= 0);

ALTER TABLE "stock_movements"
  ADD CONSTRAINT "stock_movements_type_rule"
  CHECK (
    ("type" = 'RESTOCK'          AND "quantity_change" > 0)
    OR ("type" = 'RETURN'        AND "quantity_change" > 0)
    OR ("type" = 'REQUEST_APPROVED' AND "quantity_change" < 0 AND "request_id" IS NOT NULL)
    OR ("type" = 'ADJUST'        AND "note" IS NOT NULL AND length(trim("note")) > 0)
  );

-- Backfill: existing equipment gets an opening balance so the ledger invariant holds.
INSERT INTO "stock_movements" ("id", "equipment_id", "type", "quantity_change", "balance_after", "actor_id", "note", "created_at")
SELECT gen_random_uuid(), e."id", 'ADJUST', e."stock_quantity", e."stock_quantity",
       (SELECT u."id" FROM "users" u WHERE u."role" = 'ADMIN' ORDER BY u."created_at" LIMIT 1),
       'Opening balance (ledger introduced)', now()
FROM "equipment" e
WHERE e."stock_quantity" > 0
  AND EXISTS (SELECT 1 FROM "users" u WHERE u."role" = 'ADMIN');
