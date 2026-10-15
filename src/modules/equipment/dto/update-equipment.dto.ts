import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateEquipmentDto } from './create-equipment.dto';

/**
 * stockQuantity is intentionally NOT editable here — stock changes must go
 * through POST /stock-movements so every change is recorded in the ledger.
 */
export class UpdateEquipmentDto extends PartialType(
  OmitType(CreateEquipmentDto, ['stockQuantity'] as const),
) {}
