import { type CaptureMinutes, catalogInfo } from '../../domain/catalog.js';
import type { DeviceView, GetDeviceQuery, GetDeviceQueryPort } from '../port/in/query/get-device-query.js';
import type { ListCatalogsPort } from '../port/out/list-catalogs-port.js';
import type { PortTypeCatalogPort } from '../port/out/port-type-catalog-port.js';
import type { ProjectGraphReadPort } from '../port/out/project-graph-read-port.js';
import type { WorldMachineSessionPort } from '../port/out/world-machine-session-port.js';

export class GetDeviceService implements GetDeviceQueryPort {
  readonly #session: WorldMachineSessionPort;
  readonly #graph: ProjectGraphReadPort;
  readonly #portTypes: PortTypeCatalogPort;
  readonly #captureMinutes: CaptureMinutes | undefined;
  /** For the capture offer: whether the build has enum options. */
  readonly #catalogs: ListCatalogsPort | undefined;

  constructor(
    session: WorldMachineSessionPort,
    graph: ProjectGraphReadPort,
    portTypes: PortTypeCatalogPort,
    captureMinutes?: CaptureMinutes,
    catalogs?: ListCatalogsPort,
  ) {
    this.#captureMinutes = captureMinutes;
    this.#catalogs = catalogs;
    this.#session = session;
    this.#graph = graph;
    this.#portTypes = portTypes;
  }

  async getDevice(query: GetDeviceQuery): Promise<DeviceView> {
    const device = await this.#graph.getDevice(query.device);
    // After the read, which started World Machine if needed: only a start reads the build.
    const status = this.#session.status();
    return {
      device,
      session: status.session,
      catalog: catalogInfo(
        status.systemInfo?.build,
        this.#portTypes.catalogInUse(),
        this.#portTypes.problems(),
        this.#portTypes.hasCorrections(),
        this.#captureMinutes,
        this.#catalogs?.enumCatalogs().some((catalog) => catalog.build === status.systemInfo?.build) ?? false,
      ),
    };
  }
}
