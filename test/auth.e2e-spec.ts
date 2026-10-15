import { bearer, createTestContext, TestContext } from './utils/test-app';

describe('Auth & authorization (e2e)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContext();
  });
  afterAll(() => ctx.close());

  it('rejects wrong credentials', () =>
    ctx
      .http()
      .post('/auth/login')
      .send({ email: 'admin@company.com', password: 'wrong' })
      .expect(401));

  it('requires a token', () => ctx.http().get('/equipment').expect(401));

  it('returns the current user without password hash', async () => {
    const res = await ctx
      .http()
      .get('/auth/me')
      .set(bearer(ctx.employeeToken))
      .expect(200);
    expect(res.body).toMatchObject({
      email: 'employee1@company.com',
      role: 'EMPLOYEE',
    });
    expect(res.body).not.toHaveProperty('passwordHash');
  });

  const uuid = '00000000-0000-0000-0000-000000000000';
  it.each([
    ['get', '/requests'],
    ['post', '/equipment'],
    ['patch', `/equipment/${uuid}`],
    ['patch', `/requests/${uuid}/approve`],
    ['patch', `/requests/${uuid}/reject`],
    ['get', '/stock-movements'],
    ['post', '/stock-movements'],
  ] as const)('forbids employee from %s %s', (method, path) =>
    ctx
      .http()
      [method](path)
      .set(bearer(ctx.employeeToken))
      .send({})
      .expect(403),
  );

  it('forbids admin from creating requests', () =>
    ctx
      .http()
      .post('/requests')
      .set(bearer(ctx.adminToken))
      .send({})
      .expect(403));
});
