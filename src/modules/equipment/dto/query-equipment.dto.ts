import { EquipmentStatus } from '@prisma/client';
import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { Trim } from '../../../common/transformers/trim.transformer';

export class QueryEquipmentDto extends PaginationQueryDto {
  /** Search by equipment name (case-insensitive, partial match). */
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  /** Admin only — employees always see ACTIVE equipment. */
  @IsOptional()
  @IsEnum(EquipmentStatus)
  status?: EquipmentStatus;
}
