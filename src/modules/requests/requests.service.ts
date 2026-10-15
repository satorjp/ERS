import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  EquipmentStatus,
  Prisma,
  RequestStatus,
  Role,
  StockMovementType,
} from '@prisma/client';
import { AuthUser } from '../../common/interfaces/auth-user.interface';
import { paginate } from '../../common/utils/paginate';
import { PrismaService } from '../../database/prisma.service';
import { CreateRequestDto } from './dto/create-request.dto';
import { QueryRequestsDto } from './dto/query-requests.dto';
import { RejectRequestDto } from './dto/reject-request.dto';
import { requestDetailSelect, requestSelect } from './requests.select';
import { StockMovementsService } from '../stock-movements/stock-movements.service';

@Injectable()
export class RequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stockMovements: StockMovementsService,
  ) {}

  /** Employee creates a PENDING request. Stock is NOT deducted here. */
  create(dto: CreateRequestDto, user: AuthUser) {
    return this.prisma.$transaction(async (tx) => {
      const equipment = await tx.equipment.findUnique({
        where: { id: dto.equipmentId },
      });
      if (!equipment) throw new NotFoundException('Equipment not found');
      if (equipment.status !== EquipmentStatus.ACTIVE) {
        throw new ConflictException('Equipment is not available for request');
      }
      if (equipment.stockQuantity <= 0) {
        throw new ConflictException('Equipment is out of stock');
      }
      if (dto.quantity > equipment.stockQuantity) {
        throw new ConflictException(
          `Requested quantity exceeds available stock (${equipment.stockQuantity})`,
        );
      }

      const request = await tx.equipmentRequest.create({
        data: {
          requesterId: user.id,
          equipmentId: dto.equipmentId,
          quantity: dto.quantity,
          reason: dto.reason,
        },
        select: { id: true },
      });
      await tx.auditLog.create({
        data: {
          requestId: request.id,
          actorId: user.id,
          fromStatus: null,
          toStatus: RequestStatus.PENDING,
        },
      });
      return tx.equipmentRequest.findUniqueOrThrow({
        where: { id: request.id },
        select: requestSelect,
      });
    });
  }

  /**
   * Approve = status change + stock deduction + stock ledger + audit log
   * in ONE transaction.
   * Conditional updates (WHERE status = PENDING / stock >= qty) make this safe
   * against double-approval and concurrent approvals competing for stock;
   * any thrown error rolls back every step.
   */
  approve(id: string, admin: AuthUser) {
    return this.prisma.$transaction(async (tx) => {
      const request = await tx.equipmentRequest.findUnique({ where: { id } });
      if (!request) throw new NotFoundException('Request not found');

      const updated = await tx.equipmentRequest.updateMany({
        where: { id, status: RequestStatus.PENDING },
        data: {
          status: RequestStatus.APPROVED,
          approvedAt: new Date(),
          reviewedById: admin.id,
        },
      });
      if (updated.count === 0) {
        throw new ConflictException('Request is no longer pending');
      }

      // Deduct stock + write REQUEST_APPROVED ledger row (throws 409 if not possible).
      await this.stockMovements.applyChange(tx, {
        equipmentId: request.equipmentId,
        type: StockMovementType.REQUEST_APPROVED,
        quantityChange: -request.quantity,
        actorId: admin.id,
        requestId: id,
        requireActive: true,
      });

      await tx.auditLog.create({
        data: {
          requestId: id,
          actorId: admin.id,
          fromStatus: RequestStatus.PENDING,
          toStatus: RequestStatus.APPROVED,
        },
      });
      return tx.equipmentRequest.findUniqueOrThrow({
        where: { id },
        select: requestDetailSelect,
      });
    });
  }

  /** Reject = status change + reject_reason + audit log. Stock is untouched. */
  reject(id: string, dto: RejectRequestDto, admin: AuthUser) {
    return this.prisma.$transaction(async (tx) => {
      const exists = await tx.equipmentRequest.count({ where: { id } });
      if (!exists) throw new NotFoundException('Request not found');

      const updated = await tx.equipmentRequest.updateMany({
        where: { id, status: RequestStatus.PENDING },
        data: {
          status: RequestStatus.REJECTED,
          rejectReason: dto.rejectReason,
          rejectedAt: new Date(),
          reviewedById: admin.id,
        },
      });
      if (updated.count === 0) {
        throw new ConflictException('Request is no longer pending');
      }

      await tx.auditLog.create({
        data: {
          requestId: id,
          actorId: admin.id,
          fromStatus: RequestStatus.PENDING,
          toStatus: RequestStatus.REJECTED,
          note: dto.rejectReason,
        },
      });
      return tx.equipmentRequest.findUniqueOrThrow({
        where: { id },
        select: requestDetailSelect,
      });
    });
  }

  /** Admin: all requests with status filter, search and pagination. */
  findAll(query: QueryRequestsDto) {
    return this.list(query);
  }

  /** Employee: own request history. */
  findMine(query: QueryRequestsDto, user: AuthUser) {
    return this.list(query, { requesterId: user.id });
  }

  async findOne(id: string, user: AuthUser) {
    const request = await this.prisma.equipmentRequest.findUnique({
      where: { id },
      select: requestDetailSelect,
    });
    // Hide other employees' requests entirely (404 rather than 403).
    if (
      !request ||
      (user.role !== Role.ADMIN && request.requester.id !== user.id)
    ) {
      throw new NotFoundException('Request not found');
    }
    return request;
  }

  private async list(
    query: QueryRequestsDto,
    scope: Prisma.EquipmentRequestWhereInput = {},
  ) {
    const where: Prisma.EquipmentRequestWhereInput = {
      ...scope,
      status: query.status,
      ...(query.q && {
        OR: [
          { equipment: { name: { contains: query.q, mode: 'insensitive' } } },
          {
            requester: {
              fullName: { contains: query.q, mode: 'insensitive' },
            },
          },
        ],
      }),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.equipmentRequest.findMany({
        where,
        select: requestSelect,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.equipmentRequest.count({ where }),
    ]);
    return paginate(data, total, query.page, query.limit);
  }
}
