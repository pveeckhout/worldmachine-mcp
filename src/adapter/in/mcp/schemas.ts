import * as z from 'zod/v4';

const projectBindingSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('fresh') }),
  z.object({ kind: z.literal('opened'), path: z.string() }),
]);

export const sessionSummarySchema = z.object({
  state: z.enum(['notRunning', 'starting', 'ready', 'unhealthy']),
  binding: projectBindingSchema.optional(),
  dirty: z.boolean().optional(),
  reason: z.string().optional(),
});

export const statusViewSchema = z.object({
  configured: z.boolean(),
  executable: z.string().nullable(),
  build: z.number().int().optional(),
  buildName: z.string().optional(),
  session: sessionSummarySchema,
});

const deviceSummarySchema = z.object({
  id: z.number().int(),
  name: z.string(),
  kind: z.string().optional(),
});

export const deviceListViewSchema = z.object({
  devices: z.array(deviceSummarySchema),
  session: sessionSummarySchema,
});

export const listDevicesInputSchema = z.object({
  filter: z.string().min(1).optional().describe("Filter text passed to World Machine's device list command"),
});

export const noInputSchema = z.object({});
