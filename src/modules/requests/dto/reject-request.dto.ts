import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { Trim } from '../../../common/transformers/trim.transformer';

export class RejectRequestDto {
  /** @example Out of budget this quarter */
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  rejectReason!: string;
}
