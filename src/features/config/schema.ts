import { z } from "zod";

const environmentSchemaBase = z.object({
  name: z.string().min(1),
  url: z.string().min(1),
  resource: z.string().optional(),
  userAgent: z.string().optional(),
  userAgentEnabled: z.boolean().optional(),
  authType: z.enum(["interactive", "clientSecret"]).optional(),
  createMissingComponents: z.boolean().optional(),
});

export const environmentSchema = environmentSchemaBase.transform((env) => {
  return {
    ...env,
    createMissingComponents: env.createMissingComponents ?? false,
    userAgentEnabled: env.userAgentEnabled ?? false,
  };
});

const solutionSchemaBase = z.object({
  name: z.string().min(1).optional(),
  solutionName: z.string().min(1).optional(),
  prefix: z.string().min(1),
});

export const solutionSchema = solutionSchemaBase
  .superRefine((solution, ctx) => {
    if (!solution.name && !solution.solutionName) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Solution name is required",
        path: ["name"],
      });
    }
  })
  .transform((solution) => ({
    name: solution.name ?? solution.solutionName ?? "",
    prefix: solution.prefix,
  }));

export const configurationSchema = z.object({
  environments: z.array(environmentSchema),
  solutions: z.array(solutionSchema),
});

export const bindingEntrySchema = z.object({
  relativeLocalPath: z.string().min(1),
  remotePath: z.string().min(1),
  solutionName: z.string().min(1),
  kind: z.enum(["file", "folder"]),
});

export const bindingsSchema = z.object({
  bindings: z.array(bindingEntrySchema),
});

export const publishCacheEntrySchema = z.object({
  mtime: z.number(),
  size: z.number(),
  hash: z.string(),
});

export const publishCacheSchema = z.record(z.string(), publishCacheEntrySchema);

export type EnvironmentConfig = z.input<typeof environmentSchema>;
export type NormalizedEnvironmentConfig = z.output<typeof environmentSchema>;
export type SolutionConfig = z.output<typeof solutionSchema>;
export type Dynamics365Configuration = z.output<typeof configurationSchema>;
export type BindingEntry = z.output<typeof bindingEntrySchema>;
export type BindingSnapshot = z.output<typeof bindingsSchema>;
export type PublishCacheEntry = z.output<typeof publishCacheEntrySchema>;
export type PublishCache = z.output<typeof publishCacheSchema>;
