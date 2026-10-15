import { Prisma } from '@prisma/client';

export const requestSelect = {
  id: true,
  quantity: true,
  reason: true,
  status: true,
  rejectReason: true,
  approvedAt: true,
  rejectedAt: true,
  createdAt: true,
  updatedAt: true,
  equipment: {
    select: {
      id: true,
      name: true,
      stockQuantity: true,
      status: true,
      category: { select: { id: true, name: true } },
    },
  },
  requester: { select: { id: true, fullName: true, email: true } },
  reviewedBy: { select: { id: true, fullName: true } },
} satisfies Prisma.EquipmentRequestSelect;

export const requestDetailSelect = {
  ...requestSelect,
  auditLogs: {
    select: {
      id: true,
      fromStatus: true,
      toStatus: true,
      note: true,
      createdAt: true,
      actor: { select: { id: true, fullName: true, role: true } },
    },
    orderBy: { createdAt: 'asc' },
  },
  stockMovements: {
    select: {
      id: true,
      type: true,
      quantityChange: true,
      balanceAfter: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  },
} satisfies Prisma.EquipmentRequestSelect;
