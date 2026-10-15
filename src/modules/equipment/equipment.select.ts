import { Prisma } from '@prisma/client';

export const equipmentSelect = {
  id: true,
  name: true,
  stockQuantity: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  category: { select: { id: true, name: true } },
} satisfies Prisma.EquipmentSelect;
