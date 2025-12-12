import { z } from "zod";

const environmentSchemaBase = z.object({
  name: z.string().min(1),
  url: z.string().min(1),
  resource: z.string().optional(),
  userAgent: z.string().optional(),
  userAgentEnabled: z.boolean().optional(),
  authType: z.enum(["interactive", "clientSecret"]).optional(),
  createMissingWebResources: z.boolean().optional(),
});

export const environmentSchema = environmentSchemaBase.transform((env) => ({
  ...env,
  createMissingWebResources: env.createMissingWebResources ?? false,
  userAgentEnabled: env.userAgentEnabled ?? false,
}));

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
