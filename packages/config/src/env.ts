import { z } from 'zod';

export const baseEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development')
});

export function parseEnv<T extends z.ZodRawShape>(shape: T, source: Record<string, string | undefined>) {
  const schema = baseEnvSchema.extend(shape);
  return schema.parse(source);
}

export type ParsedEnv<T extends z.ZodRawShape> = z.infer<z.ZodObject<T>> & z.infer<typeof baseEnvSchema>;
