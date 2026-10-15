import * as z from 'zod/v4';
import type { RawGraphSpec } from '../domain/graph-spec.js';

// Spec v3 section 4. The schema admits the structure only; validateGraphSpec refuses everything else with REFUSED,
// so a rule broken is a tool result, not a protocol error (plan decision D6).
const graphDeviceSchema = z.strictObject({
  name: z
    .string()
    .describe(
      'Without id, the managed device: its name is its identity, compared regardless of case. With id, a label that inputs refer to, and the new name when rename is true. At most 23 characters',
    ),
  id: z
    .number()
    .optional()
    .describe(
      'The id (from list_devices, add_device, or an apply diff, without the #) of an existing device this entry manages whatever its name; such an entry is never added, and is renamed to its name only with rename: true',
    ),
  rename: z
    .boolean()
    .optional()
    .describe(
      "Only with id: true renames the device to this entry's name; without it the name is a label that is never sent to World Machine",
    ),
  type: z.string().describe('The exact World Machine device type, as add_device takes it'),
  enabled: z.boolean().optional(),
  bypassed: z
    .boolean()
    .optional()
    .describe('true to bypass the device, false to remove its bypass; omitted leaves it as it is'),
  parameters: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
    .optional()
    .describe('Parameter name to value, in the forms update_device_parameters takes'),
  inputs: z
    .record(z.string(), z.string().nullable())
    .optional()
    .describe('Input port number to its source, "<device>" or "<device>.<output port>", or null for no wire'),
});

export const graphSpecSchema = z.strictObject({
  version: z.number().describe('Must be 1'),
  scene: z
    .strictObject({
      name: z.string().optional(),
      origin_km: z.strictObject({ x: z.number(), y: z.number() }).optional(),
      size_km: z.strictObject({ width: z.number(), height: z.number() }).optional(),
      resolution: z.number().optional(),
    })
    .optional()
    .describe(
      "The current scene's settings, as configure_scene takes them; origin and size in km with at most two decimals",
    ),
  devices: z.array(graphDeviceSchema),
  remove: z.array(z.string()).optional().describe('Device names or #<id> to delete; absence never deletes'),
}) satisfies z.ZodType<RawGraphSpec>;
