import { StockMovementType } from '@prisma/client';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  NotEquals,
} from 'class-validator';
import { Trim } from '../../../common/transformers/trim.transformer';

/** REQUEST_APPROVED is system-only (written by the approve flow). */
export const MANUAL_MOVEMENT_TYPES = [
  StockMovementType.RESTOCK,
  StockMovementType.ADJUST,
  StockMovementType.RETURN,
] as const;
export type ManualMovementType = (typeof MANUAL_MOVEMENT_TYPES)[number];

export class CreateStockMovementDto {
  @IsUUID()
  equipmentId!: string;

  @IsIn(MANUAL_MOVEMENT_TYPES)
  type!: ManualMovementType;

  /**
   * Signed change. RESTOCK / RETURN must be positive; ADJUST may be +/-.
   * @example 5
   */
  @IsInt()
  @NotEquals(0)
  @Min(-1_000_000)
  @Max(1_000_000)
  quantityChange!: number;

  /** Required for ADJUST. @example Stock count found 2 damaged units */
  @IsOptional()
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  note?: string;

  /** Optional link for RETURN — must be an APPROVED request of the same equipment. */
  @IsOptional()
  @IsUUID()
  requestId?: string;
}
