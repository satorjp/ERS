import { Prisma } from '@prisma/client';

export const stockMovementSelect = {
  id: true,
  type: true,
  quantityChange: true,
  balanceAfter: true,
  note: true,
  createdAt: true,
  equipment: { select: { id: true, name: true } },
  actor: { select: { id: true, fullName: true } },
  request: {
    select: {
      id: true,
      quantity: true,
      requester: { select: { id: true, fullName: true } },
    },
  },
} satisfies Prisma.StockMovementSelect;
