import * as z from 'zod/v4';
import type { AddDeviceView } from '../../../application/port/in/command/add-device-command.js';
import type { ApplyGraphView } from '../../../application/port/in/command/apply-graph-command.js';
import type { BuildProjectView } from '../../../application/port/in/command/build-project-command.js';
import type { ConfigureSceneView } from '../../../application/port/in/command/configure-scene-command.js';
import type { ConnectDevicesView } from '../../../application/port/in/command/connect-devices-command.js';
import type { CreateSnapshotView } from '../../../application/port/in/command/create-snapshot-command.js';
import type { DeleteDeviceView } from '../../../application/port/in/command/delete-device-command.js';
import type { DeleteSnapshotView } from '../../../application/port/in/command/delete-snapshot-command.js';
import type { DisconnectDevicesView } from '../../../application/port/in/command/disconnect-devices-command.js';
import type { ExportOutputsView } from '../../../application/port/in/command/export-outputs-command.js';
import type { OrganizeDevicesView } from '../../../application/port/in/command/organize-devices-command.js';
import type { ProjectCommandView } from '../../../application/port/in/command/project-command-view.js';
import type { RenameDeviceView } from '../../../application/port/in/command/rename-device-command.js';
import type { RestoreSnapshotView } from '../../../application/port/in/command/restore-snapshot-command.js';
import type { SetDeviceBypassedView } from '../../../application/port/in/command/set-device-bypassed-command.js';
import type { SetDeviceEnabledView } from '../../../application/port/in/command/set-device-enabled-command.js';
import type { SetGroupEnabledView } from '../../../application/port/in/command/set-group-enabled-command.js';
import type { StopBuildView } from '../../../application/port/in/command/stop-build-command.js';
import type { UpdateDeviceParametersView } from '../../../application/port/in/command/update-device-parameters-command.js';
import type { BuildStatusView } from '../../../application/port/in/query/get-build-status-query.js';
import type { DeviceView } from '../../../application/port/in/query/get-device-query.js';
import type { SceneView } from '../../../application/port/in/query/get-scene-query.js';
import type { StatusView } from '../../../application/port/in/query/get-status-query.js';
import type { ProjectView } from '../../../application/port/in/query/inspect-project-query.js';
import type { DeviceListView } from '../../../application/port/in/query/list-devices-query.js';
import type { ListExportsView } from '../../../application/port/in/query/list-exports-query.js';
import type { GroupListView } from '../../../application/port/in/query/list-groups-query.js';
import type { SnapshotListView } from '../../../application/port/in/query/list-snapshots-query.js';
import type { PlanGraphView } from '../../../application/port/in/query/plan-graph-query.js';
import type {
  DeviceDetail,
  DeviceSummary,
  InputPort,
  OutputPort,
  Parameter,
  PortLink,
} from '../../../domain/device.js';
import type { DiffEntry } from '../../../domain/graph-diff.js';
import type { PlanStep } from '../../../domain/graph-plan.js';
import type { RawGraphSpec } from '../../../domain/graph-spec.js';
import type { Group } from '../../../domain/group.js';
import type { CheckedExportTarget } from '../../../domain/output-template.js';
import type { ProjectOverview } from '../../../domain/project.js';
import type { Scene, SceneSummary } from '../../../domain/scene.js';
import type { ProjectBinding, SessionSummary } from '../../../domain/session.js';
import type { Snapshot } from '../../../domain/snapshot.js';

const projectBindingSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('fresh') }),
  z.strictObject({ kind: z.literal('opened'), path: z.string() }),
]) satisfies z.ZodType<ProjectBinding>;

export const sessionSummarySchema = z.strictObject({
  state: z.enum(['notRunning', 'starting', 'ready', 'unhealthy', 'stopping']),
  binding: projectBindingSchema.optional(),
  dirty: z.boolean().optional(),
  reason: z.string().optional(),
  recovered: z.literal(true).optional(),
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
    z.strictObject({
      name: z.string(),
      type: z.string(),
      value: z.string(),
      options: z.array(z.string()).optional(),
    }) satisfies z.ZodType<Parameter>,
  ),
  inputs: z.array(
    z.strictObject({
      port: z.number().int(),
      name: z.string(),
      source: portLinkSchema.optional(),
      accepts: z.array(z.string()).optional(),
    }) satisfies z.ZodType<InputPort>,
  ),
  outputs: z.array(
    z.strictObject({
      port: z.number().int(),
      name: z.string(),
      targets: z.array(portLinkSchema),
      type: z.string().optional(),
    }) satisfies z.ZodType<OutputPort>,
  ),
  enumOptionsNote: z.array(z.string()).optional(),
  portTypes: z.enum(['catalogued', 'unknown']),
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

export const setDeviceBypassedInputSchema = z.object({
  device: deviceReferenceSchema,
  bypassed: z.boolean().describe('true to bypass the device, false to remove its bypass'),
});

export const deleteDeviceInputSchema = z.object({ device: deviceReferenceSchema });

export const updateDeviceParametersInputSchema = z.object({
  device: deviceReferenceSchema,
  parameters: z
    .record(z.string().min(1), z.union([z.string(), z.number(), z.boolean()]))
    .describe(
      'Parameter name, exactly as get_device lists it, to the new value: an internal value, or, for a float that shows m or km, a length in m or km such as 500 m',
    ),
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

export const setDeviceBypassedViewSchema = z.strictObject({
  device: deviceRefSchema,
  bypassed: z.boolean(),
  changed: z.boolean(),
  session: sessionSummarySchema,
}) satisfies z.ZodType<SetDeviceBypassedView>;

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
      given: z.string().optional(),
      scale: z.string().optional(),
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

// Spec v2a builds and exports. Output field names follow the v1 views (camelCase, with `session`), decision D1.

// Spec v2b section 4: groups are referenced by name, compared regardless of case, or by index.
const groupReferenceSchema = z
  .string()
  .min(1)
  .describe('Group name (any case) or its index as #<n>, as list_groups shows them');

const buildModeSchema = z.enum(['preview', 'full', 'tiled', 'group']);

export const buildProjectInputSchema = z.object({
  mode: buildModeSchema.describe('preview, full, tiled, or group; see the tool description'),
  group: groupReferenceSchema
    .optional()
    .describe('Mode group only, and required there: group name (any case) or #<n> (see list_groups)'),
  wait_seconds: z
    .number()
    .int()
    .min(0)
    .max(600)
    .default(60)
    .describe('Seconds to wait for the build to end, 0 to 600; the build keeps running after the wait'),
});

// Build-not-built design section 5.
const unbuiltOutputSchema = z.strictObject({ id: z.number().int(), name: z.string() });
const stoppedDeviceSchema = z.strictObject({
  id: z.number().int(),
  name: z.string(),
  type: z.string(),
  enabled: z.boolean(),
  bypassed: z.boolean(),
});

export const buildProjectViewSchema = z.strictObject({
  state: z.enum(['finished', 'running']),
  mode: buildModeSchema,
  elapsedSeconds: z.number().int().min(0),
  outputFolders: z.array(z.string()).optional(),
  group: groupSchema.optional(),
  outputsBuilt: z.boolean().optional(),
  notBuilt: z.array(unbuiltOutputSchema).optional(),
  stoppedAt: z.array(stoppedDeviceSchema).optional(),
  hint: z.string().optional(),
  outputsCheckError: z.string().optional(),
  session: sessionSummarySchema,
}) satisfies z.ZodType<BuildProjectView>;

// Build-status-check design section 5: build_project's fields, for the run that startedAt names (plan decision D13).
const lastFullBuildSchema = z.strictObject({
  startedAt: z.iso.datetime(),
  outputsBuilt: z.boolean().optional(),
  notBuilt: z.array(unbuiltOutputSchema).optional(),
  stoppedAt: z.array(stoppedDeviceSchema).optional(),
  hint: z.string().optional(),
  outputsCheckError: z.string().optional(),
});

export const buildStatusViewSchema = z.strictObject({
  build: z
    .strictObject({
      // `unknown` only for a run World Machine started whose kind has not shown (spec v2a section 3).
      mode: z.enum(['full', 'tiled', 'unknown']),
      elapsedSeconds: z.number().int().min(0),
      startedBy: z.enum(['server', 'world-machine']),
    })
    .nullable(),
  previewRunning: z.boolean(),
  lastFullBuild: lastFullBuildSchema.optional(),
  session: sessionSummarySchema,
}) satisfies z.ZodType<BuildStatusView>;

export const stopBuildViewSchema = z.strictObject({
  stopped: z.enum(['preview', 'full', 'tiled', 'unknown']).nullable(),
  session: sessionSummarySchema,
}) satisfies z.ZodType<StopBuildView>;

const checkedExportTargetSchema = z.strictObject({
  device: z.string(),
  template: z.string(),
  path: z.string().nullable(),
  allowed: z.boolean(),
  reason: z.string().optional(),
}) satisfies z.ZodType<CheckedExportTarget>;

export const listExportsViewSchema = z.strictObject({
  projectFolder: z.string().nullable(),
  targets: z.array(checkedExportTargetSchema),
  session: sessionSummarySchema,
}) satisfies z.ZodType<ListExportsView>;

export const exportOutputsViewSchema = z.strictObject({
  files: z.array(z.string()),
  note: z.string().optional(),
  session: sessionSummarySchema,
}) satisfies z.ZodType<ExportOutputsView>;

// Spec v2b snapshots, organize, and groups (section 3). Output fields are camelCase and every view carries session.

const snapshotSchema = z.strictObject({
  index: z.number().int(),
  name: z.string(),
  created: z.string(),
}) satisfies z.ZodType<Snapshot>;

export const snapshotListViewSchema = z.strictObject({
  snapshots: z.array(snapshotSchema),
  session: sessionSummarySchema,
}) satisfies z.ZodType<SnapshotListView>;

export const createSnapshotInputSchema = z.object({
  name: z
    .string()
    .min(1)
    .describe(
      'Name for the new snapshot: 1 to 64 characters, unique in the project, no leading or trailing spaces',
    ),
});

export const createSnapshotViewSchema = z.strictObject({
  index: z.number().int(),
  name: z.string(),
  created: z.string(),
  session: sessionSummarySchema,
}) satisfies z.ZodType<CreateSnapshotView>;

export const snapshotReferenceInputSchema = z.object({
  snapshot: z
    .string()
    .min(1)
    .describe('Snapshot name, exactly as list_snapshots shows it, or its index as #<n>'),
});

export const restoreSnapshotViewSchema = z.strictObject({
  index: z.number().int(),
  name: z.string(),
  session: sessionSummarySchema,
}) satisfies z.ZodType<RestoreSnapshotView>;

export const deleteSnapshotViewSchema = z.strictObject({
  index: z.number().int(),
  name: z.string(),
  remaining: z.array(snapshotSchema),
  session: sessionSummarySchema,
}) satisfies z.ZodType<DeleteSnapshotView>;

export const organizeDevicesViewSchema = z.strictObject({
  session: sessionSummarySchema,
}) satisfies z.ZodType<OrganizeDevicesView>;

export const listGroupsInputSchema = z.object({
  filter: z.string().min(1).optional().describe("Filter text passed to World Machine's group list command"),
});

export const groupListViewSchema = z.strictObject({
  groups: z.array(groupSchema),
  session: sessionSummarySchema,
}) satisfies z.ZodType<GroupListView>;

export const setGroupEnabledInputSchema = z.object({
  group: groupReferenceSchema,
  enabled: z.boolean().describe('true to enable every device of the group, false to disable them'),
});

export const setGroupEnabledViewSchema = z.strictObject({
  index: z.number().int(),
  name: z.string(),
  deviceCount: z.number().int(),
  enabled: z.boolean(),
  session: sessionSummarySchema,
}) satisfies z.ZodType<SetGroupEnabledView>;

// Spec v3 section 4. The schema admits the structure only; validateGraphSpec refuses everything else with REFUSED,
// so a rule broken is a tool result, not a protocol error (plan decision D6).
const graphDeviceSchema = z.strictObject({
  name: z
    .string()
    .describe(
      'Without id, the managed device: its name is its identity, compared regardless of case. With id, a label that inputs refer to. At most 23 characters',
    ),
  id: z
    .number()
    .optional()
    .describe(
      'The id (from list_devices, add_device, or an apply diff, without the #) of an existing device this entry manages whatever its name; such an entry is never added or renamed',
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
  devices: z.array(graphDeviceSchema),
  remove: z.array(z.string()).optional().describe('Device names or #<id> to delete; absence never deletes'),
}) satisfies z.ZodType<RawGraphSpec>;

export const planGraphInputSchema = z.object({ spec: graphSpecSchema });

export const applyGraphInputSchema = z.object({
  spec: graphSpecSchema,
  plan_id: z.string().describe('The planId plan_graph returned for this spec'),
  keep_snapshot: z
    .boolean()
    .optional()
    .describe('Keep the apply snapshot after a successful apply (default false)'),
});

const stepSourceSchema = z.strictObject({
  device: z.string(),
  id: z.number().int().optional(),
  port: z.number().int(),
});

const planStepSchema = z.discriminatedUnion('op', [
  z.strictObject({
    op: z.literal('disconnect'),
    device: z.string(),
    id: z.number().int(),
    port: z.number().int(),
    from: z.string(),
    source: z.strictObject({ device: z.string(), id: z.number().int(), port: z.number().int() }),
  }),
  z.strictObject({
    op: z.literal('remove'),
    device: z.string(),
    id: z.number().int(),
    wiresRemoved: z.array(z.string()),
  }),
  z.strictObject({ op: z.literal('add'), device: z.string(), type: z.string() }),
  z.strictObject({
    op: z.literal('set-enabled'),
    device: z.string(),
    id: z.number().int().optional(),
    from: z.boolean().optional(),
    to: z.boolean(),
  }),
  z.strictObject({
    op: z.literal('set-bypassed'),
    device: z.string(),
    id: z.number().int().optional(),
    from: z.boolean().optional(),
    to: z.boolean(),
  }),
  z.strictObject({
    op: z.literal('set-parameter'),
    device: z.string(),
    id: z.number().int().optional(),
    name: z.string(),
    from: z.string().optional(),
    to: z.string(),
    comparable: z.boolean(),
  }),
  z.strictObject({
    op: z.literal('connect'),
    device: z.string(),
    id: z.number().int().optional(),
    port: z.number().int(),
    from: z.string(),
    source: stepSourceSchema,
  }),
]) satisfies z.ZodType<PlanStep>;

export const planGraphViewSchema = z.strictObject({
  planId: z.string(),
  conflicts: z.array(z.strictObject({ entry: z.string(), reason: z.string() })),
  steps: z.array(planStepSchema),
  unchanged: z.array(z.string()),
  uncheckedWires: z.array(z.string()),
  session: sessionSummarySchema,
}) satisfies z.ZodType<PlanGraphView>;

const changeOf = <T extends z.ZodType>(value: T) => z.strictObject({ before: value, after: value });

const diffEntrySchema = z.discriminatedUnion('change', [
  z.strictObject({
    device: z.string(),
    change: z.literal('added'),
    after: z.strictObject({
      id: z.number().int(),
      type: z.string(),
      enabled: z.boolean(),
      bypassed: z.boolean(),
      parameters: z.record(z.string(), z.string()),
      inputs: z.record(z.string(), z.string()),
    }),
  }),
  z.strictObject({
    device: z.string(),
    change: z.literal('removed'),
    before: z.strictObject({ id: z.number().int(), type: z.string() }),
  }),
  z.strictObject({
    device: z.string(),
    change: z.literal('changed'),
    id: z.number().int(),
    enabled: changeOf(z.boolean()).optional(),
    bypassed: changeOf(z.boolean()).optional(),
    parameters: z.record(z.string(), changeOf(z.string())).optional(),
    inputs: z.record(z.string(), changeOf(z.string().nullable())).optional(),
  }),
]) satisfies z.ZodType<DiffEntry>;

export const applyGraphViewSchema = z.strictObject({
  applied: z.number().int(),
  snapshot: z.string().nullable(),
  diff: z.array(diffEntrySchema),
  diffError: z.string().optional(),
  session: sessionSummarySchema,
}) satisfies z.ZodType<ApplyGraphView>;
