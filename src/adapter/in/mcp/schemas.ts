import * as z from 'zod/v4';

const projectBindingSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('fresh') }),
  z.object({ kind: z.literal('opened'), path: z.string() }),
]);

export const sessionSummarySchema = z.object({
  state: z.enum(['notRunning', 'starting', 'ready', 'unhealthy', 'stopping']),
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
  enabled: z.boolean(),
  bypassed: z.boolean(),
});

export const deviceListViewSchema = z.object({
  devices: z.array(deviceSummarySchema),
  session: sessionSummarySchema,
});

export const listDevicesInputSchema = z.object({
  filter: z.string().min(1).optional().describe("Filter text passed to World Machine's device list command"),
});

export const noInputSchema = z.object({});

const portLinkSchema = z.object({ device: z.string(), port: z.number().int() });

const deviceDetailSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  type: z.string(),
  enabled: z.boolean(),
  bypassed: z.boolean(),
  parameters: z.array(z.object({ name: z.string(), type: z.string(), value: z.string() })),
  inputs: z.array(z.object({ port: z.number().int(), name: z.string(), source: portLinkSchema.optional() })),
  outputs: z.array(z.object({ port: z.number().int(), name: z.string(), targets: z.array(portLinkSchema) })),
});

const sceneSchema = z.object({
  name: z.string(),
  index: z.number().int(),
  count: z.number().int(),
  originKm: z.object({ x: z.number(), y: z.number() }),
  sizeKm: z.object({ width: z.number(), height: z.number() }),
  resolution: z.number().int(),
  locked: z.boolean(),
});

export const deviceViewSchema = z.object({ device: deviceDetailSchema, session: sessionSummarySchema });

export const sceneViewSchema = z.object({ scene: sceneSchema, session: sessionSummarySchema });

export const projectViewSchema = z.object({
  project: z.object({
    scene: sceneSchema,
    scenes: z.array(
      z.object({
        index: z.number().int(),
        name: z.string(),
        widthKm: z.number(),
        heightKm: z.number(),
        resolution: z.number().int(),
        current: z.boolean(),
      }),
    ),
    deviceCount: z.number().int(),
    devices: z.array(deviceSummarySchema),
    groups: z.array(z.object({ index: z.number().int(), name: z.string(), deviceCount: z.number().int() })),
  }),
  session: sessionSummarySchema,
});

export const projectCommandViewSchema = z.object({
  session: sessionSummarySchema,
  path: z.string().optional(),
});

export const getDeviceInputSchema = z.object({
  device: z.string().min(1).describe('Device name, or its stable id as #<n> (see list_devices)'),
});

export const openProjectInputSchema = z.object({
  path: z.string().min(1).describe('Absolute path of an existing .tmd file inside the allowed roots'),
  discard_unsaved: z.boolean().default(false).describe('Discard unsaved changes in the current project'),
});

export const createProjectInputSchema = z.object({
  discard_unsaved: z.boolean().default(false).describe('Discard unsaved changes in the current project'),
});

export const saveProjectInputSchema = z.object({
  path: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Absolute .tmd path inside the allowed roots; defaults to the path the project was opened or saved from',
    ),
  overwrite: z.boolean().default(false).describe('Replace an existing file'),
});
