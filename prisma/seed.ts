/**
 * Seed data — see database-design.md §9.
 * Re-runnable: wipes all tables, then inserts a fresh, consistent dataset
 * (stock ledger included: SUM(quantity_change) per equipment = stock_quantity).
 */
import {
  EquipmentStatus,
  PrismaClient,
  RequestStatus,
  Role,
  StockMovementType,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const USERS = [
  {
    email: 'admin@company.com',
    password: 'Admin@1234',
    fullName: 'Alice Admin',
    role: Role.ADMIN,
  },
  {
    email: 'employee1@company.com',
    password: 'Employee@1234',
    fullName: 'Somchai Jaidee',
    role: Role.EMPLOYEE,
  },
  {
    email: 'employee2@company.com',
    password: 'Employee@1234',
    fullName: 'Suda Rakdee',
    role: Role.EMPLOYEE,
  },
] as const;

const CATEGORIES = ['Monitor', 'Keyboard', 'Mouse', 'Headset', 'Accessories'];

const EQUIPMENT: {
  name: string;
  category: string;
  stockQuantity: number;
  status?: EquipmentStatus;
}[] = [
  { name: 'Dell 24" Monitor P2422H', category: 'Monitor', stockQuantity: 15 },
  { name: 'LG 27" 4K Monitor 27UP850', category: 'Monitor', stockQuantity: 5 },
  // Out of stock — employees must not be able to request it.
  { name: 'Samsung 32" Curved Monitor', category: 'Monitor', stockQuantity: 0 },
  { name: 'Logitech MX Keys', category: 'Keyboard', stockQuantity: 20 },
  { name: 'Keychron K2', category: 'Keyboard', stockQuantity: 8 },
  // Inactive — hidden from employees.
  {
    name: 'IBM Model M (Retired)',
    category: 'Keyboard',
    stockQuantity: 3,
    status: EquipmentStatus.INACTIVE,
  },
  { name: 'Logitech MX Master 3S', category: 'Mouse', stockQuantity: 25 },
  {
    name: 'Microsoft Basic Optical Mouse',
    category: 'Mouse',
    stockQuantity: 40,
  },
  { name: 'Jabra Evolve2 65', category: 'Headset', stockQuantity: 10 },
  { name: 'Sony WH-1000XM5', category: 'Headset', stockQuantity: 2 },
  {
    name: 'Anker USB-C Hub 7-in-1',
    category: 'Accessories',
    stockQuantity: 30,
  },
  {
    name: 'Rain Design Laptop Stand',
    category: 'Accessories',
    stockQuantity: 12,
  },
  { name: 'HDMI Cable 2m', category: 'Accessories', stockQuantity: 50 },
];

const REASONS = [
  'Current one is broken',
  'New hire onboarding',
  'Need a second screen for development work',
  'Working from home setup',
  'Replacement for a faulty unit',
  'Project requires additional equipment',
];

const REJECT_REASONS = [
  'Budget limit reached for this quarter',
  'Please use the shared equipment in the meeting room',
  'Duplicate request',
];

async function main() {
  // Children first because of RESTRICT foreign keys.
  await prisma.$transaction([
    prisma.stockMovement.deleteMany(),
    prisma.requestAttachment.deleteMany(),
    prisma.auditLog.deleteMany(),
    prisma.equipmentRequest.deleteMany(),
    prisma.equipment.deleteMany(),
    prisma.category.deleteMany(),
    prisma.user.deleteMany(),
  ]);

  const users = await Promise.all(
    USERS.map(async ({ password, ...u }) =>
      prisma.user.create({
        data: { ...u, passwordHash: await bcrypt.hash(password, 10) },
      }),
    ),
  );
  const admin = users.find((u) => u.role === Role.ADMIN)!;
  const employees = users.filter((u) => u.role === Role.EMPLOYEE);

  const categories = new Map<string, string>();
  for (const name of CATEGORIES) {
    const c = await prisma.category.create({ data: { name } });
    categories.set(name, c.id);
  }

  const equipment = [];
  for (const e of EQUIPMENT) {
    equipment.push(
      await prisma.equipment.create({
        data: {
          name: e.name,
          categoryId: categories.get(e.category)!,
          stockQuantity: e.stockQuantity,
          status: e.status ?? EquipmentStatus.ACTIVE,
        },
      }),
    );
  }
  const requestable = equipment.filter(
    (e) => e.status === EquipmentStatus.ACTIVE && e.stockQuantity > 0,
  );

  // Ledger rows (other than the opening balance), collected per equipment.
  type SeedMovement = {
    type: StockMovementType;
    quantityChange: number;
    actorId: string;
    requestId?: string;
    note?: string;
    createdAt: Date;
  };
  const movements = new Map<string, SeedMovement[]>(
    equipment.map((e) => [e.id, []]),
  );

  // 24 historical requests across all statuses (enough for 3 pages of 10).
  // Stock above is treated as "after" these approvals; the ledger below
  // derives an opening balance so SUM(quantity_change) = stock_quantity.
  const statuses = [
    RequestStatus.PENDING,
    RequestStatus.APPROVED,
    RequestStatus.REJECTED,
  ];
  const now = Date.now();
  for (let i = 0; i < 24; i++) {
    const requester = employees[i % employees.length];
    const item = requestable[i % requestable.length];
    const status = statuses[i % statuses.length];
    const createdAt = new Date(now - (24 - i) * DAY);
    const reviewedAt = new Date(createdAt.getTime() + 3 * HOUR);
    const rejectReason =
      status === RequestStatus.REJECTED
        ? REJECT_REASONS[i % REJECT_REASONS.length]
        : null;

    const auditLogs: {
      actorId: string;
      fromStatus: RequestStatus | null;
      toStatus: RequestStatus;
      note?: string | null;
      createdAt: Date;
    }[] = [
      {
        actorId: requester.id,
        fromStatus: null,
        toStatus: RequestStatus.PENDING,
        createdAt,
      },
    ];
    if (status !== RequestStatus.PENDING) {
      auditLogs.push({
        actorId: admin.id,
        fromStatus: RequestStatus.PENDING,
        toStatus: status,
        note: rejectReason,
        createdAt: reviewedAt,
      });
    }

    const quantity = (i % 3) + 1;
    const created = await prisma.equipmentRequest.create({
      data: {
        requesterId: requester.id,
        equipmentId: item.id,
        quantity,
        reason: REASONS[i % REASONS.length],
        status,
        rejectReason,
        reviewedById: status === RequestStatus.PENDING ? null : admin.id,
        approvedAt: status === RequestStatus.APPROVED ? reviewedAt : null,
        rejectedAt: status === RequestStatus.REJECTED ? reviewedAt : null,
        createdAt,
        updatedAt: status === RequestStatus.PENDING ? createdAt : reviewedAt,
        auditLogs: { create: auditLogs },
      },
    });

    if (status === RequestStatus.APPROVED) {
      movements.get(item.id)!.push({
        type: StockMovementType.REQUEST_APPROVED,
        quantityChange: -quantity,
        actorId: admin.id,
        requestId: created.id,
        createdAt: reviewedAt,
      });
      // Sample return: the first approved request gives 1 unit back later.
      if (i === 1) {
        movements.get(item.id)!.push({
          type: StockMovementType.RETURN,
          quantityChange: 1,
          actorId: admin.id,
          requestId: created.id,
          note: 'Returned after project ended',
          createdAt: new Date(reviewedAt.getTime() + 5 * DAY),
        });
      }
    }
  }

  // Sample manual correction after a stock count.
  const hdmi = equipment.find((e) => e.name === 'HDMI Cable 2m')!;
  movements.get(hdmi.id)!.push({
    type: StockMovementType.ADJUST,
    quantityChange: -2,
    actorId: admin.id,
    note: 'Stock count: 2 damaged cables written off',
    createdAt: new Date(now - 2 * DAY),
  });

  // Build the ledger: opening RESTOCK + chronological movements with running balance.
  let movementCount = 0;
  for (const e of equipment) {
    const rows = movements
      .get(e.id)!
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const opening =
      e.stockQuantity - rows.reduce((sum, m) => sum + m.quantityChange, 0);
    if (opening > 0) {
      rows.unshift({
        type: StockMovementType.RESTOCK,
        quantityChange: opening,
        actorId: admin.id,
        note: 'Initial stock',
        createdAt: new Date(now - 30 * DAY),
      });
    }

    let balance = 0;
    await prisma.stockMovement.createMany({
      data: rows.map((m) => ({
        ...m,
        equipmentId: e.id,
        balanceAfter: (balance += m.quantityChange),
      })),
    });
    movementCount += rows.length;
  }

  console.log(
    `Seeded ${users.length} users, ${categories.size} categories, ` +
      `${equipment.length} equipment, 24 requests, ${movementCount} stock movements.`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
