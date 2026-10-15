import { ConflictException, NotFoundException } from '@nestjs/common';
import {
  EquipmentStatus,
  RequestStatus,
  Role,
  StockMovementType,
} from '@prisma/client';
import { AuthUser } from '../../common/interfaces/auth-user.interface';
import { PrismaService } from '../../database/prisma.service';
import { StockMovementsService } from '../stock-movements/stock-movements.service';
import { RequestsService } from './requests.service';

const admin: AuthUser = {
  id: 'admin-id',
  email: 'admin@company.com',
  fullName: 'Admin',
  role: Role.ADMIN,
};

/** Minimal transaction client mock; $transaction just runs the callback. */
function createTx() {
  return {
    equipmentRequest: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'req-1' }),
      updateMany: jest.fn(),
      count: jest.fn(),
    },
    equipment: {
      updateMany: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
    stockMovement: { create: jest.fn() },
    auditLog: { create: jest.fn() },
  };
}

describe('RequestsService', () => {
  let tx: ReturnType<typeof createTx>;
  let service: RequestsService;

  beforeEach(() => {
    tx = createTx();
    const prisma = {
      $transaction: (fn: (t: typeof tx) => unknown) => fn(tx),
    } as unknown as PrismaService;
    service = new RequestsService(prisma, new StockMovementsService(prisma));
  });

  describe('approve', () => {
    const pending = {
      id: 'req-1',
      equipmentId: 'eq-1',
      quantity: 2,
      status: RequestStatus.PENDING,
    };

    it('updates status, deducts stock, writes ledger and audit log', async () => {
      tx.equipmentRequest.findUnique.mockResolvedValue(pending);
      tx.equipmentRequest.updateMany.mockResolvedValue({ count: 1 });
      tx.equipment.updateMany.mockResolvedValue({ count: 1 });
      tx.equipment.findUniqueOrThrow.mockResolvedValue({ stockQuantity: 3 });

      await service.approve('req-1', admin);

      expect(tx.equipmentRequest.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'req-1', status: RequestStatus.PENDING },
        }),
      );
      expect(tx.equipment.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'eq-1',
          status: EquipmentStatus.ACTIVE,
          stockQuantity: { gte: 2 },
        },
        data: { stockQuantity: { increment: -2 } },
      });
      expect(tx.stockMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            equipmentId: 'eq-1',
            type: StockMovementType.REQUEST_APPROVED,
            quantityChange: -2,
            balanceAfter: 3,
            requestId: 'req-1',
            actorId: admin.id,
          }),
        }),
      );
      expect(tx.auditLog.create).toHaveBeenCalledWith({
        data: {
          requestId: 'req-1',
          actorId: admin.id,
          fromStatus: RequestStatus.PENDING,
          toStatus: RequestStatus.APPROVED,
        },
      });
    });

    it('throws 404 when the request does not exist', async () => {
      tx.equipmentRequest.findUnique.mockResolvedValue(null);
      await expect(service.approve('missing', admin)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('throws 409 and skips stock/audit when not pending', async () => {
      tx.equipmentRequest.findUnique.mockResolvedValue(pending);
      tx.equipmentRequest.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.approve('req-1', admin)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(tx.equipment.updateMany).not.toHaveBeenCalled();
      expect(tx.stockMovement.create).not.toHaveBeenCalled();
      expect(tx.auditLog.create).not.toHaveBeenCalled();
    });

    it('throws 409 and skips ledger/audit when stock is insufficient', async () => {
      tx.equipmentRequest.findUnique.mockResolvedValue(pending);
      tx.equipmentRequest.updateMany.mockResolvedValue({ count: 1 });
      tx.equipment.updateMany.mockResolvedValue({ count: 0 });
      tx.equipment.findUnique.mockResolvedValue({
        status: EquipmentStatus.ACTIVE,
        stockQuantity: 1,
      });

      await expect(service.approve('req-1', admin)).rejects.toThrow(
        'Insufficient stock (available 1, requested 2)',
      );
      expect(tx.stockMovement.create).not.toHaveBeenCalled();
      expect(tx.auditLog.create).not.toHaveBeenCalled();
    });

    it('reports inactive equipment distinctly', async () => {
      tx.equipmentRequest.findUnique.mockResolvedValue(pending);
      tx.equipmentRequest.updateMany.mockResolvedValue({ count: 1 });
      tx.equipment.updateMany.mockResolvedValue({ count: 0 });
      tx.equipment.findUnique.mockResolvedValue({
        status: EquipmentStatus.INACTIVE,
        stockQuantity: 10,
      });

      await expect(service.approve('req-1', admin)).rejects.toThrow(
        'Equipment is inactive and cannot be issued',
      );
    });
  });

  describe('reject', () => {
    it('stores the reason, writes audit log and never touches stock', async () => {
      tx.equipmentRequest.count.mockResolvedValue(1);
      tx.equipmentRequest.updateMany.mockResolvedValue({ count: 1 });

      await service.reject('req-1', { rejectReason: 'Budget' }, admin);

      expect(tx.equipmentRequest.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'req-1', status: RequestStatus.PENDING },
          data: expect.objectContaining({
            status: RequestStatus.REJECTED,
            rejectReason: 'Budget',
          }),
        }),
      );
      expect(tx.equipment.updateMany).not.toHaveBeenCalled();
      expect(tx.stockMovement.create).not.toHaveBeenCalled();
      expect(tx.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          toStatus: RequestStatus.REJECTED,
          note: 'Budget',
        }),
      });
    });

    it('throws 409 when the request is no longer pending', async () => {
      tx.equipmentRequest.count.mockResolvedValue(1);
      tx.equipmentRequest.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.reject('req-1', { rejectReason: 'x' }, admin),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(tx.auditLog.create).not.toHaveBeenCalled();
    });
  });
});
