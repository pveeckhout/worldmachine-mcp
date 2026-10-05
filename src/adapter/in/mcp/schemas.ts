import * as z from 'zod/v4';
import type { AddDeviceView } from '../../../application/port/in/command/add-device-command.js';
import type { ConfigureSceneView } from '../../../application/port/in/command/configure-scene-command.js';
import type { ConnectDevicesView } from '../../../application/port/in/command/connect-devices-command.js';
import type { DeleteDeviceView } from '../../../application/port/in/command/delete-device-command.js';
import type { DisconnectDevicesView } from '../../../application/port/in/command/disconnect-devices-command.js';
import type { ProjectCommandView } from '../../../application/port/in/command/project-command-view.js';
import type { RenameDeviceView } from '../../../application/port/in/command/rename-device-command.js';
import type { SetDeviceEnabledView } from '../../../application/port/in/command/set-device-enabled-command.js';
import type { UpdateDeviceParametersView } from '../../../application/port/in/command/update-device-parameters-command.js';
import type { DeviceView } from '../../../application/port/in/query/get-device-query.js';
import type { SceneView } from '../../../application/port/in/query/get-scene-query.js';
import type { StatusView } from '../../../application/port/in/query/get-status-query.js';
import type { ProjectView } from '../../../application/port/in/query/inspect-project-query.js';
import type { DeviceListView } from '../../../application/port/in/query/list-devices-query.js';
import type {
  DeviceDetail,
  DeviceSummary,
  InputPort,
  OutputPort,
  Parameter,
  PortLink,
} from '../../../domain/device.js';
import type { Group } from '../../../domain/group.js';
import type { ProjectOverview } from '../../../domain/project.js';
import type { Scene, SceneSummary } from '../../../domain/scene.js';
import type { ProjectBinding, SessionSummary } from '../../../domain/session.js';

const projectBindingSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('fresh') }),
  z.strictObject({ kind: z.literal('opened'), path: z.string() }),
]) satisfies z.ZodType<ProjectBinding>;

export const sessionSummarySchema = z.strictObject({
  state: z.enum(['notRunning', 'starting', 'ready', 'unhealthy', 'stopping']),
  binding: projectBindingSchema.optional(),
  dirty: z.boolean().optional(),
  reason: z.string().optional(),
}) satisfies z.ZodType<SessionSummary>;

export const statusViewSchema = z.strictObject({
  configured: z.boolean(),
  executable: z.string().nullable(),
  build: z.number().int().optional(),
  buildName: z.string().optional(),
  session: sessionSummarySchema,
}) satisfies z.ZodType<StatusView>;

const deviceSummarySchema = z.strictObject({
  id: z.number().int(),
  name: z.string(),
  kind: z.string().optional(),
  enabled: z.boolean(),
  bypassed: z.boolean().optional(),
}) satisfies z.ZodType<DeviceSummary>;

export const deviceListViewSchema = z.strictObject({
  devices: z.array(deviceSummarySchema),
  session: sessionSummarySchema,
}) satisfies z.ZodType<DeviceListView>;

export const listDevicesInputSchema = z.object({
  filter: z.string().min(1).optional().describe("Filter text passed to World Machine's device list command"),
});

export const noInputSchema = z.object({});

const portLinkSchema = z.strictObject({
  device: z.string(),
  port: z.number().int(),
}) satisfies z.ZodType<PortLink>;

const deviceDetailSchema = z.strictObject({
  id: z.number().int(),
  name: z.string(),
  type: z.string(),
  enabled: z.boolean(),
  bypassed: z.boolean(),
  parameters: z.array(
    z.strictObject({ name: z.string(), type: z.string(), value: z.string() }) satisfies z.ZodType<Parameter>,
  ),
  inputs: z.array(
    z.strictObject({
      port: z.number().int(),
      name: z.string(),
      source: portLinkSchema.optional(),
    }) satisfies z.ZodType<InputPort>,
  ),
  outputs: z.array(
    z.strictObject({
      port: z.number().int(),
      name: z.string(),
      targets: z.array(portLinkSchema),
    }) satisfies z.ZodType<OutputPort>,
  ),
}) satisfies z.ZodType<DeviceDetail>;

const sceneSchema = z.strictObject({
  name: z.string(),
  index: z.number().int(),
  count: z.number().int(),
  originKm: z.strictObject({ x: z.number(), y: z.number() }),
  sizeKm: z.strictObject({ width: z.number(), height: z.number() }),
  resolution: z.number().int(),
  locked: z.boolean(),
}) satisfies z.ZodType<Scene>;

const sceneSummarySchema = z.strictObject({
  index: z.number().int(),
  name: z.string(),
  widthKm: z.number(),
  heightKm: z.number(),
  resolution: z.number().int(),
  current: z.boolean(),
}) satisfies z.ZodType<SceneSummary>;

const groupSchema = z.strictObject({
  index: z.number().int(),
  name: z.string(),
  deviceCount: z.number().int(),
}) satisfies z.ZodType<Group>;

const projectOverviewSchema = z.strictObject({
  scene: sceneSchema,
  scenes: z.array(sceneSummarySchema),
  deviceCount: z.number().int(),
  devices: z.array(deviceSummarySchema),
  groups: z.array(groupSchema),
}) satisfies z.ZodType<ProjectOverview>;

export const deviceViewSchema = z.strictObject({
  device: deviceDetailSchema,
  session: sessionSummarySchema,
}) satisfies z.ZodType<DeviceView>;

export const sceneViewSchema = z.strictObject({
  scene: sceneSchema,
  session: sessionSummarySchema,
}) satisfies z.ZodType<SceneView>;

export const projectViewSchema = z.strictObject({
  project: projectOverviewSchema,
  session: sessionSummarySchema,
}) satisfies z.ZodType<ProjectView>;

export const projectCommandViewSchema = z.strictObject({
  session: sessionSummarySchema,
  path: z.string().optional(),
}) satisfies z.ZodType<ProjectCommandView>;

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

// Plan 2c edit tools. New objects are strict, so a view field missing here fails at runtime, and each view schema is
// tied to its view type, so a field missing from the view or typed differently fails the typecheck (decision D10).

const deviceReferenceSchema = z
  .string()
  .min(1)
  .describe('Device name, or its stable id as #<n> (see list_devices)');

const portSchema = z
  .number()
  .int()
  .min(1)
  .optional()
  .describe('1-based port number as get_device shows it; World Machine uses port 1 when omitted');

export const addDeviceInputSchema = z.object({
  type: z
    .string()
    .min(1)
    .describe('Exact World Machine device type, such as Gradient, Erosion, or File Output'),
  name: z
    .string()
    .min(1)
    .optional()
    .describe('Name for the new device; without it World Machine names the device after its type'),
});

export const renameDeviceInputSchema = z.object({
  device: deviceReferenceSchema,
  name: z.string().min(1).describe('New device name'),
});

export const setDeviceEnabledInputSchema = z.object({
  device: deviceReferenceSchema,
  enabled: z.boolean().describe('true to enable the device, false to disable it'),
});

export const deleteDeviceInputSchema = z.object({ device: deviceReferenceSchema });

export const updateDeviceParametersInputSchema = z.object({
  device: deviceReferenceSchema,
  parameters: z
    .record(z.string().min(1), z.union([z.string(), z.number(), z.boolean()]))
    .describe('Parameter name, exactly as get_device lists it, to the new value'),
});

export const wireInputSchema = z.object({
  source: deviceReferenceSchema.describe('Device whose output port the wire starts at: name or #<n>'),
  source_port: portSchema,
  destination: deviceReferenceSchema.describe('Device whose input port the wire ends at: name or #<n>'),
  destination_port: portSchema,
});

export const configureSceneInputSchema = z.object({
  name: z.string().min(1).optional().describe('New scene name'),
  origin_km: z.object({ x: z.number(), y: z.number() }).optional().describe('Scene centre in km'),
  size_km: z
    .object({ width: z.number().positive(), height: z.number().positive() })
    .optional()
    .describe('Scene width and height in km'),
  resolution: z.number().int().positive().optional().describe('Render resolution in pixels, a whole number'),
});

const deviceRefSchema = z.strictObject({ id: z.number().int(), name: z.string() });

const editedDeviceSchema = z.strictObject({
  id: z.number().int(),
  name: z.string(),
  kind: z.string().optional(),
  enabled: z.boolean(),
  bypassed: z.boolean().optional(),
});

const wireEndSchema = z.strictObject({ id: z.number().int(), name: z.string(), port: z.number().int() });

export const addDeviceViewSchema = z.strictObject({
  device: editedDeviceSchema,
  session: sessionSummarySchema,
}) satisfies z.ZodType<AddDeviceView>;

export const renameDeviceViewSchema = z.strictObject({
  device: editedDeviceSchema,
  previousName: z.string(),
  session: sessionSummarySchema,
}) satisfies z.ZodType<RenameDeviceView>;

export const setDeviceEnabledViewSchema = z.strictObject({
  device: deviceRefSchema,
  enabled: z.boolean(),
  changed: z.boolean(),
  session: sessionSummarySchema,
}) satisfies z.ZodType<SetDeviceEnabledView>;

export const deleteDeviceViewSchema = z.strictObject({
  deleted: editedDeviceSchema,
  session: sessionSummarySchema,
}) satisfies z.ZodType<DeleteDeviceView>;

export const updateDeviceParametersViewSchema = z.strictObject({
  device: deviceRefSchema,
  parameters: z.array(
    z.strictObject({
      name: z.string(),
      type: z.string(),
      requested: z.string(),
      outcome: z.enum(['applied', 'rejected']),
      value: z.string(),
      worldMachineMessage: z.string().optional(),
    }),
  ),
  session: sessionSummarySchema,
}) satisfies z.ZodType<UpdateDeviceParametersView>;

export const connectDevicesViewSchema = z.strictObject({
  source: wireEndSchema,
  destination: wireEndSchema,
  created: z.boolean(),
  session: sessionSummarySchema,
}) satisfies z.ZodType<ConnectDevicesView>;

export const disconnectDevicesViewSchema = z.strictObject({
  source: wireEndSchema,
  destination: wireEndSchema,
  removed: z.boolean(),
  session: sessionSummarySchema,
}) satisfies z.ZodType<DisconnectDevicesView>;

export const configureSceneViewSchema = z.strictObject({
  scene: sceneSchema,
  session: sessionSummarySchema,
}) satisfies z.ZodType<ConfigureSceneView>;
