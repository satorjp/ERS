import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  EquipmentStatus,
  Prisma,
  Role,
  StockMovementType,
} from '@prisma/client';
import { AuthUser } from '../../common/interfaces/auth-user.interface';
import { paginate } from '../../common/utils/paginate';
import { PrismaService } from '../../database/prisma.service';
import { StockMovementsService } from '../stock-movements/stock-movements.service';
import { CreateEquipmentDto } from './dto/create-equipment.dto';
import { QueryEquipmentDto } from './dto/query-equipment.dto';
import { UpdateEquipmentDto } from './dto/update-equipment.dto';
import { equipmentSelect } from './equipment.select';

@Injectable()
export class EquipmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stockMovements: StockMovementsService,
  ) {}

  async findAll(query: QueryEquipmentDto, user: AuthUser) {
    const where: Prisma.EquipmentWhereInput = {
      status: user.role === Role.ADMIN ? query.status : EquipmentStatus.ACTIVE,
      categoryId: query.categoryId,
      ...(query.q && { name: { contains: query.q, mode: 'insensitive' } }),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.equipment.findMany({
        where,
        select: equipmentSelect,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.equipment.count({ where }),
    ]);
    return paginate(data, total, query.page, query.limit);
  }

  async findOne(id: string, user: AuthUser) {
    const equipment = await this.prisma.equipment.findUnique({
      where: { id },
      select: equipmentSelect,
    });
    // Employees cannot see INACTIVE equipment, so treat it as not found.
    if (
      !equipment ||
      (user.role !== Role.ADMIN && equipment.status !== EquipmentStatus.ACTIVE)
    ) {
      throw new NotFoundException('Equipment not found');
    }
    return equipment;
  }

  /** Creates equipment at 0 stock, then books the opening stock in the ledger. */
  async create(dto: CreateEquipmentDto, admin: AuthUser) {
    await this.assertCategoryExists(dto.categoryId);
    const { stockQuantity, ...data } = dto;

    return this.prisma.$transaction(async (tx) => {
      const equipment = await tx.equipment.create({
        data: { ...data, stockQuantity: 0 },
      });
      if (stockQuantity > 0) {
        await this.stockMovements.applyChange(tx, {
          equipmentId: equipment.id,
          type: StockMovementType.RESTOCK,
          quantityChange: stockQuantity,
          actorId: admin.id,
          note: 'Initial stock',
        });
      }
      return tx.equipment.findUniqueOrThrow({
        where: { id: equipment.id },
        select: equipmentSelect,
      });
    });
  }

  async update(id: string, dto: UpdateEquipmentDto) {
    if (dto.categoryId) await this.assertCategoryExists(dto.categoryId);
    // Missing id → Prisma P2025 → 404 via PrismaExceptionFilter.
    return this.prisma.equipment.update({
      where: { id },
      data: dto,
      select: equipmentSelect,
    });
  }

  private async assertCategoryExists(categoryId: string) {
    const exists = await this.prisma.category.count({
      where: { id: categoryId },
    });
    if (!exists) throw new BadRequestException('Category does not exist');
  }
}
