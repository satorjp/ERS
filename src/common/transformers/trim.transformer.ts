import { Transform } from 'class-transformer';

/** Trims string input so "   " fails @IsNotEmpty(). */
export const Trim = () =>
  Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));
