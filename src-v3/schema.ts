import { z } from 'zod';

/**
 * Schema for Arvo error objects.
 *
 * This schema defines the structure of error objects used in the Arvo system.
 * It uses Zod for runtime type checking and validation.
 */
export const ArvoErrorSchema = z.object({
  errorName: z.string().describe('The name of the error.'),
  errorMessage: z.string().describe('A descriptive message for the error.'),
  errorStack: z.string().nullable().describe('The stack trace of the error.'),
});

// Zod schema for ArvoSemanticVersion
export const ArvoSemanticVersionSchema = z
  .string()
  .regex(/^\d+\.\d+\.\d+$/, 'Invalid version format of the semantic version')
  .describe('Semantic version of the Arvo component in the format X.Y.Z');

// Check is the provided version is a valid arvo semantic version
export const isValidArvoSemanticVersion = (version: string) => ArvoSemanticVersionSchema.safeParse(version).success;
