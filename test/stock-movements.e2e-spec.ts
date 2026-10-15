import { StockMovementType } from '@prisma/client';
import { bearer, createTestContext, TestContext } from './utils/test-app';

describe('Stock ledger (e2e)', () => {
  let ctx: TestContext;

  const record = (body: Record<string, unknown>) =>
    ctx.http().post('/stock-movements').set(bearer(ctx.adminToken)).send(body);

  beforeAll(async () => {
    ctx = await createTestContext();
  });
  afterAll(() => ctx.close());

  it('RESTOCK increases stock and records balance', async () => {
    const equipmentId = await ctx.createEquipment(5);
    const res = await record({
      equipmentId,
      type: StockMovementType.RESTOCK,
      quantityChange: 10,
      note: 'PO-123',
    }).expect(201);
    expect(res.body).toMatchObject({ quantityChange: 10, balanceAfter: 15 });
    expect(await ctx.stockOf(equipmentId)).toBe(15);
  });

  it('ADJUST can decrease stock but requires a note', async () => {
    const equipmentId = await ctx.createEquipment(5);
    await record({
      equipmentId,
      type: StockMovementType.ADJUST,
      quantityChange: -2,
    }).expect(400);
    const res = await record({
      equipmentId,
      type: StockMovementType.ADJUST,
      quantityChange: -2,
      note: 'Damaged',
    }).expect(201);
    expect(res.body.balanceAfter).toBe(3);
  });

  it('never lets stock go negative', async () => {
    const equipmentId = await ctx.createEquipment(2);
    await record({
      equipmentId,
      type: StockMovementType.ADJUST,
      quantityChange: -3,
      note: 'Too much',
    }).expect(409);
    expect(await ctx.stockOf(equipmentId)).toBe(2);
  });

  it.each([
    [{ type: StockMovementType.RESTOCK, quantityChange: -1 }],
    [{ type: StockMovementType.RETURN, quantityChange: -1 }],
    [{ type: StockMovementType.RESTOCK, quantityChange: 0 }],
    [{ type: StockMovementType.REQUEST_APPROVED, quantityChange: -1 }],
  ])('rejects invalid movement %j', async (body) => {
    const equipmentId = await ctx.createEquipment(5);
    await record({ equipmentId, ...body }).expect(400);
  });

  it('approval writes a REQUEST_APPROVED movement linked to the request', async () => {
    const equipmentId = await ctx.createEquipment(5);
    const requestId = await ctx.createRequest(equipmentId, 2);
    const res = await ctx.approve(requestId).expect(200);

    expect(res.body.stockMovements).toEqual([
      expect.objectContaining({
        type: StockMovementType.REQUEST_APPROVED,
        quantityChange: -2,
        balanceAfter: 3,
      }),
    ]);
  });

  it('failed approval writes no movement', async () => {
    const equipmentId = await ctx.createEquipment(3);
    const requestId = await ctx.createRequest(equipmentId, 3);
    await record({
      equipmentId,
      type: StockMovementType.ADJUST,
      quantityChange: -2,
      note: 'Lost',
    }).expect(201);

    await ctx.approve(requestId).expect(409);
    const count = await ctx.prisma.stockMovement.count({
      where: { requestId },
    });
    expect(count).toBe(0);
  });

  it('RETURN linked to a request cannot exceed the issued quantity', async () => {
    const equipmentId = await ctx.createEquipment(5);
    const requestId = await ctx.createRequest(equipmentId, 2);
    const pendingReturn = {
      equipmentId,
      requestId,
      type: StockMovementType.RETURN,
    };

    await record({ ...pendingReturn, quantityChange: 1 }).expect(409); // not approved yet
    await ctx.approve(requestId).expect(200);
    await record({ ...pendingReturn, quantityChange: 1 }).expect(201);
    await record({ ...pendingReturn, quantityChange: 2 }).expect(409);
    await record({ ...pendingReturn, quantityChange: 1 }).expect(201);
    expect(await ctx.stockOf(equipmentId)).toBe(5);
  });

  it('lists movements filtered by equipment, newest first', async () => {
    const equipmentId = await ctx.createEquipment(5);
    await record({
      equipmentId,
      type: StockMovementType.RESTOCK,
      quantityChange: 1,
    });
    const res = await ctx
      .http()
      .get(`/stock-movements?equipmentId=${equipmentId}`)
      .set(bearer(ctx.adminToken))
      .expect(200);
    expect(res.body.meta.total).toBe(2);
    expect(
      res.body.data.map((m: { balanceAfter: number }) => m.balanceAfter),
    ).toEqual([6, 5]);
  });

  it('ledger sum equals stock for every equipment', async () => {
    const rows = await ctx.prisma.$queryRaw<
      { name: string; stock: number; ledger: number }[]
    >`
      SELECT e.name, e.stock_quantity AS stock,
             COALESCE(SUM(m.quantity_change), 0)::int AS ledger
      FROM equipment e
      LEFT JOIN stock_movements m ON m.equipment_id = e.id
      GROUP BY e.id
      HAVING e.stock_quantity <> COALESCE(SUM(m.quantity_change), 0)`;
    expect(rows).toEqual([]);
  });
});
