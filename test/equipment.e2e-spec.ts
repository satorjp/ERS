import { EquipmentStatus, StockMovementType } from '@prisma/client';
import { bearer, createTestContext, TestContext } from './utils/test-app';

describe('Equipment (e2e)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContext();
  });
  afterAll(() => ctx.close());

  it('hides INACTIVE equipment from employees', async () => {
    const res = await ctx
      .http()
      .get('/equipment?limit=100')
      .set(bearer(ctx.employeeToken))
      .expect(200);
    const statuses = res.body.data.map(
      (e: { status: EquipmentStatus }) => e.status,
    );
    expect(statuses).not.toContain(EquipmentStatus.INACTIVE);
  });

  it('records opening stock as a RESTOCK movement', async () => {
    const id = await ctx.createEquipment(7);
    const movements = await ctx.prisma.stockMovement.findMany({
      where: { equipmentId: id },
    });
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({
      type: StockMovementType.RESTOCK,
      quantityChange: 7,
      balanceAfter: 7,
    });
  });

  it('does not allow editing stockQuantity directly', async () => {
    const id = await ctx.createEquipment(5);
    await ctx
      .http()
      .patch(`/equipment/${id}`)
      .set(bearer(ctx.adminToken))
      .send({ stockQuantity: 100 })
      .expect(400);
    expect(await ctx.stockOf(id)).toBe(5);
  });

  it('allows editing other fields', async () => {
    const id = await ctx.createEquipment(5);
    const res = await ctx
      .http()
      .patch(`/equipment/${id}`)
      .set(bearer(ctx.adminToken))
      .send({ name: 'Renamed item', status: EquipmentStatus.INACTIVE })
      .expect(200);
    expect(res.body).toMatchObject({
      name: 'Renamed item',
      status: 'INACTIVE',
    });
  });
});
