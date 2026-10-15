import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import * as request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';

export const ADMIN = { email: 'admin@company.com', password: 'Admin@1234' };
export const EMPLOYEE = {
  email: 'employee1@company.com',
  password: 'Employee@1234',
};

export interface TestContext {
  app: INestApplication;
  prisma: PrismaClient;
  adminToken: string;
  employeeToken: string;
  http: () => ReturnType<typeof request>;
  /** Creates ACTIVE equipment with an opening RESTOCK via the API (ledger-consistent). */
  createEquipment: (stockQuantity: number) => Promise<string>;
  /** Creates a PENDING request as the employee. */
  createRequest: (equipmentId: string, quantity: number) => Promise<string>;
  /** Approves a request as admin. */
  approve: (requestId: string) => request.Test;
  stockOf: (equipmentId: string) => Promise<number>;
  close: () => Promise<void>;
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

export async function createTestContext(): Promise<TestContext> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();

  const prisma = new PrismaClient();
  const http = () => request(app.getHttpServer());

  const login = async ({ email, password }: typeof ADMIN) => {
    const res = await http()
      .post('/auth/login')
      .send({ email, password })
      .expect(200);
    return res.body.accessToken as string;
  };
  const adminToken = await login(ADMIN);
  const employeeToken = await login(EMPLOYEE);
  const categoryId = (await prisma.category.findFirstOrThrow()).id;
  let seq = 0;

  return {
    app,
    prisma,
    adminToken,
    employeeToken,
    http,
    async createEquipment(stockQuantity) {
      const res = await http()
        .post('/equipment')
        .set(bearer(adminToken))
        .send({
          name: `E2E item ${Date.now()}-${seq++}`,
          categoryId,
          stockQuantity,
        })
        .expect(201);
      return res.body.id;
    },
    async createRequest(equipmentId, quantity) {
      const res = await http()
        .post('/requests')
        .set(bearer(employeeToken))
        .send({ equipmentId, quantity, reason: 'e2e test' })
        .expect(201);
      return res.body.id;
    },
    approve: (requestId) =>
      http().patch(`/requests/${requestId}/approve`).set(bearer(adminToken)),
    async stockOf(equipmentId) {
      const e = await prisma.equipment.findUniqueOrThrow({
        where: { id: equipmentId },
      });
      return e.stockQuantity;
    },
    async close() {
      await prisma.$disconnect();
      await app.close();
    },
  };
}
