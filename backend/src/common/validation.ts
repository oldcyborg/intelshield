import { ValidateIf } from 'class-validator';

/**
 * Optional, but never null. `@IsOptional()` lets `null` through, which on a NOT NULL
 * column becomes a 500; this skips validation only when the field is absent.
 */
export const IsOptionalNonNull = () => ValidateIf((_object, value) => value !== undefined);
