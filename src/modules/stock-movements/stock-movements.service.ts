import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  EquipmentStatus,
  Prisma,
  RequestStatus,
  StockMovementType,
} from '@prisma/client';
import { AuthUser } from '../../common/interfaces/auth-user.interface';
import { paginate } from '../../common/utils/paginate';
import { PrismaService } from '../../database/prisma.service';
import { CreateStockMovementDto } from './dto/create-stock-movement.dto';
import { QueryStockMovementsDto } from './dto/query-stock-movements.dto';
import { stockMovementSelect } from './stock-movements.select';

export interface StockChange {
  equipmentId: string;
  type: StockMovementType;
  /** Signed: negative deducts stock. */
  quantityChange: number;
  actorId: string;
  requestId?: string | null;
  note?: string | null;
  /** Only allow the change while the equipment is ACTIVE (used by approve). */
  requireActive?: boolean;
}

/**
 * The ONLY place that changes equipment.stock_quantity.
 * Every change writes a stock_movements row in the caller's transaction.
 */
@Injectable()
export class StockMovementsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Atomically applies a stock change and records it in the ledger.
   * Must be called inside a transaction (`tx`) so the caller's other writes
   * roll back together if this throws.
   */
  async applyChange(tx: Prisma.TransactionClient, change: StockChange) {
    const { equipmentId, quantityChange, requireActive } = change;

    // Conditional update: never lets stock go below zero, even under concurrency.
    const updated = await tx.equipment.updateMany({
      where: {
        id: equipmentId,
        ...(requireActive && { status: EquipmentStatus.ACTIVE }),
        ...(quantityChange < 0 && {
          stockQuantity: { gte: -quantityChange },
        }),
      },
      data: { stockQuantity: { increment: quantityChange } },
    });

    if (updated.count === 0) {
      const equipment = await tx.equipment.findUnique({
        where: { id: equipmentId },
      });
      if (!equipment) throw new NotFoundException('Equipment not found');
      if (requireActive && equipment.status !== EquipmentStatus.ACTIVE) {
        throw new ConflictException(
          'Equipment is inactive and cannot be issued',
        );
      }
      throw new ConflictException(
        `Insufficient stock (available ${equipment.stockQuantity}, requested ${-quantityChange})`,
      );
    }

    // Row is locked by our UPDATE until commit, so this read is our own result.
    const { stockQuantity } = await tx.equipment.findUniqueOrThrow({
      where: { id: equipmentId },
      select: { stockQuantity: true },
    });

    return tx.stockMovement.create({
      data: {
        equipmentId,
        type: change.type,
        quantityChange,
        balanceAfter: stockQuantity,
        actorId: change.actorId,
        requestId: change.requestId ?? null,
        note: change.note ?? null,
      },
      select: stockMovementSelect,
    });
  }

  /** Admin manual movement: RESTOCK, ADJUST or RETURN. */
  record(dto: CreateStockMovementDto, admin: AuthUser) {
    this.assertManualRules(dto);

    return this.prisma.$transaction(async (tx) => {
      if (dto.requestId) await this.assertReturnable(tx, dto);
      return this.applyChange(tx, { ...dto, actorId: admin.id });
    });
  }

  async findAll(query: QueryStockMovementsDto) {
    const where: Prisma.StockMovementWhereInput = {
      equipmentId: query.equipmentId,
      type: query.type,
      requestId: query.requestId,
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.stockMovement.findMany({
        where,
        select: stockMovementSelect,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.stockMovement.count({ where }),
    ]);
    return paginate(data, total, query.page, query.limit);
  }

  private assertManualRules(dto: CreateStockMovementDto) {
    const { type, quantityChange, note, requestId } = dto;
    if (
      (type === StockMovementType.RESTOCK ||
        type === StockMovementType.RETURN) &&
      quantityChange <= 0
    ) {
      throw new BadRequestException(`${type} quantityChange must be positive`);
    }
    if (type === StockMovementType.ADJUST && !note) {
      throw new BadRequestException('note is required for ADJUST');
    }
    if (requestId && type !== StockMovementType.RETURN) {
      throw new BadRequestException('requestId is only allowed for RETURN');
    }
  }

  /** A RETURN linked to a request cannot exceed what that request took out. */
  private async assertReturnable(
    tx: Prisma.TransactionClient,
    dto: CreateStockMovementDto,
  ) {
    const request = await tx.equipmentRequest.findUnique({
      where: { id: dto.requestId },
    });
    if (!request) throw new NotFoundException('Request not found');
    if (request.status !== RequestStatus.APPROVED) {
      throw new ConflictException('Only APPROVED requests can be returned');
    }
    if (request.equipmentId !== dto.equipmentId) {
      throw new BadRequestException('Request is for different equipment');
    }
    const returned = await tx.stockMovement.aggregate({
      where: { requestId: request.id, type: StockMovementType.RETURN },
      _sum: { quantityChange: true },
    });
    const alreadyReturned = returned._sum.quantityChange ?? 0;
    if (alreadyReturned + dto.quantityChange > request.quantity) {
      throw new ConflictException(
        `Cannot return more than issued (issued ${request.quantity}, already returned ${alreadyReturned})`,
      );
    }
  }
}
