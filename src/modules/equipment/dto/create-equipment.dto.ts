import { EquipmentStatus } from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Trim } from '../../../common/transformers/trim.transformer';

export class CreateEquipmentDto {
  /** @example Dell 24" Monitor P2422H */
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name!: string;

  @IsUUID()
  categoryId!: string;

  /** Opening stock, recorded as a RESTOCK movement. @example 10 */
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  stockQuantity!: number;

  @IsOptional()
  @IsEnum(EquipmentStatus)
  status?: EquipmentStatus;
}
