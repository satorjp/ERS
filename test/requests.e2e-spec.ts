import { RequestStatus, StockMovementType } from '@prisma/client';
import { bearer, createTestContext, TestContext } from './utils/test-app';

describe('Requests (e2e)', () => {
  let ctx: TestContext;

  /** Reduce stock through the ledger (as an admin stock count would). */
  const writeOff = (equipmentId: string, quantity: number) =>
    ctx
      .http()
      .post('/stock-movements')
      .set(bearer(ctx.adminToken))
      .send({
        equipmentId,
        type: StockMovementType.ADJUST,
        quantityChange: -quantity,
        note: 'e2e write-off',
      })
      .expect(201);

  beforeAll(async () => {
    ctx = await createTestContext();
  });
  afterAll(() => ctx.close());

  describe('create', () => {
    it.each([
      [{ quantity: 0, reason: 'x' }],
      [{ quantity: -1, reason: 'x' }],
      [{ quantity: 1.5, reason: 'x' }],
      [{ quantity: 1, reason: '   ' }],
      [{ quantity: 1 }],
      [{ quantity: 1, reason: 'x', status: 'APPROVED' }],
    ])('rejects invalid input %j', async (body) => {
      const equipmentId = await ctx.createEquipment(5);
      await ctx
        .http()
        .post('/requests')
        .set(bearer(ctx.employeeToken))
        .send({ equipmentId, ...body })
        .expect(400);
    });

    it('rejects out-of-stock and inactive equipment', async () => {
      const outOfStock = await ctx.createEquipment(0);
      const inactive = await ctx.createEquipment(5);
      await ctx
        .http()
        .patch(`/equipment/${inactive}`)
        .set(bearer(ctx.adminToken))
        .send({ status: 'INACTIVE' })
        .expect(200);

      for (const equipmentId of [outOfStock, inactive]) {
        await ctx
          .http()
          .post('/requests')
          .set(bearer(ctx.employeeToken))
          .send({ equipmentId, quantity: 1, reason: 'need it' })
          .expect(409);
      }
    });

    it('creates a PENDING request without deducting stock', async () => {
      const equipmentId = await ctx.createEquipment(5);
      const id = await ctx.createRequest(equipmentId, 2);

      const req = await ctx.prisma.equipmentRequest.findUniqueOrThrow({
        where: { id },
        include: { auditLogs: true },
      });
      expect(req.status).toBe(RequestStatus.PENDING);
      expect(req.auditLogs).toHaveLength(1);
      expect(req.auditLogs[0].fromStatus).toBeNull();
      expect(await ctx.stockOf(equipmentId)).toBe(5);
    });
  });

  describe('approve', () => {
    it('approves, deducts stock and writes an audit log', async () => {
      const equipmentId = await ctx.createEquipment(5);
      const id = await ctx.createRequest(equipmentId, 2);

      const res = await ctx.approve(id).expect(200);
      expect(res.body.status).toBe(RequestStatus.APPROVED);
      expect(res.body.approvedAt).toBeTruthy();
      expect(
        res.body.auditLogs.map((a: { toStatus: string }) => a.toStatus),
      ).toEqual([RequestStatus.PENDING, RequestStatus.APPROVED]);
      expect(await ctx.stockOf(equipmentId)).toBe(3);
    });

    it('cannot approve twice', async () => {
      const equipmentId = await ctx.createEquipment(5);
      const id = await ctx.createRequest(equipmentId, 1);
      await ctx.approve(id).expect(200);
      await ctx.approve(id).expect(409);
      expect(await ctx.stockOf(equipmentId)).toBe(4);
    });

    it('rolls back everything when stock is insufficient', async () => {
      const equipmentId = await ctx.createEquipment(5);
      const id = await ctx.createRequest(equipmentId, 3);
      await writeOff(equipmentId, 3); // stock drops to 2 after the request

      await ctx.approve(id).expect(409);

      const req = await ctx.prisma.equipmentRequest.findUniqueOrThrow({
        where: { id },
        include: { auditLogs: true },
      });
      expect(req.status).toBe(RequestStatus.PENDING);
      expect(req.approvedAt).toBeNull();
      expect(req.reviewedById).toBeNull();
      expect(req.auditLogs).toHaveLength(1);
      expect(await ctx.stockOf(equipmentId)).toBe(2);
    });

    it('never oversells under concurrent approvals', async () => {
      const equipmentId = await ctx.createEquipment(2);
      const ids = await Promise.all(
        [1, 2, 3].map(() => ctx.createRequest(equipmentId, 1)),
      );

      const results = await Promise.all(ids.map((id) => ctx.approve(id)));
      expect(results.map((r) => r.status).sort()).toEqual([200, 200, 409]);
      expect(await ctx.stockOf(equipmentId)).toBe(0);

      const balances = await ctx.prisma.stockMovement.findMany({
        where: { equipmentId, type: StockMovementType.REQUEST_APPROVED },
        orderBy: { balanceAfter: 'desc' },
      });
      expect(balances.map((m) => m.balanceAfter)).toEqual([1, 0]);
    });
  });

  describe('reject', () => {
    it('requires a reason', async () => {
      const id = await ctx.createRequest(await ctx.createEquipment(5), 1);
      await ctx
        .http()
        .patch(`/requests/${id}/reject`)
        .set(bearer(ctx.adminToken))
        .send({ rejectReason: '  ' })
        .expect(400);
    });

    it('rejects without touching stock', async () => {
      const equipmentId = await ctx.createEquipment(5);
      const id = await ctx.createRequest(equipmentId, 2);

      const res = await ctx
        .http()
        .patch(`/requests/${id}/reject`)
        .set(bearer(ctx.adminToken))
        .send({ rejectReason: 'Budget' })
        .expect(200);
      expect(res.body.status).toBe(RequestStatus.REJECTED);
      expect(res.body.rejectReason).toBe('Budget');
      expect(res.body.auditLogs[1].note).toBe('Budget');
      expect(res.body.stockMovements).toEqual([]);
      expect(await ctx.stockOf(equipmentId)).toBe(5);
    });
  });

  describe('listing', () => {
    it('filters, searches and paginates for admin', async () => {
      const res = await ctx
        .http()
        .get('/requests?status=APPROVED&q=somchai&page=1&limit=2')
        .set(bearer(ctx.adminToken))
        .expect(200);
      expect(res.body.data.length).toBeLessThanOrEqual(2);
      expect(res.body.meta).toMatchObject({ page: 1, limit: 2 });
      for (const r of res.body.data) {
        expect(r.status).toBe(RequestStatus.APPROVED);
        expect(r.requester.fullName).toMatch(/somchai/i);
      }
    });

    it("only returns the employee's own requests", async () => {
      const res = await ctx
        .http()
        .get('/requests/me?limit=100')
        .set(bearer(ctx.employeeToken))
        .expect(200);
      const emails = new Set(
        res.body.data.map(
          (r: { requester: { email: string } }) => r.requester.email,
        ),
      );
      expect([...emails]).toEqual(['employee1@company.com']);
    });

    it("hides other employees' requests (404)", async () => {
      const other = await ctx.prisma.equipmentRequest.findFirstOrThrow({
        where: { requester: { email: 'employee2@company.com' } },
      });
      await ctx
        .http()
        .get(`/requests/${other.id}`)
        .set(bearer(ctx.employeeToken))
        .expect(404);
    });
  });
});
