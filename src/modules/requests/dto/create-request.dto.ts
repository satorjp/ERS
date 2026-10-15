import {
  IsInt,
  IsNotEmpty,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Trim } from '../../../common/transformers/trim.transformer';

export class CreateRequestDto {
  @IsUUID()
  equipmentId!: string;

  /** Must be a positive integer. @example 1 */
  @IsInt()
  @Min(1)
  @Max(1000)
  quantity!: number;

  /** @example Replacing a broken monitor */
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason!: string;
}
