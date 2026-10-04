#!/usr/bin/env node
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createMcpServer } from './adapter/in/mcp/create-server.js';
import { FsPathPolicy } from './adapter/out/fs/path-policy.js';
import { resolveExecutable } from './adapter/out/worldmachine/locator.js';
import { WorldMachineGraphReader } from './adapter/out/worldmachine/world-machine-graph-reader.js';
import { WorldMachineProcess } from './adapter/out/worldmachine/world-machine-process.js';
import { WorldMachineSession } from './adapter/out/worldmachine/world-machine-session.js';
import { GetStatusService } from './application/service/get-status-service.js';
import { ListDevicesService } from './application/service/list-devices-service.js';
import { type Config, loadConfig } from './config.js';
import { createLogger } from './logger.js';

const READY_TIMEOUT_MS = 60_000;
const { version } = createRequire(import.meta.url)('../package.json') as { version: string };

let config: Config;
try {
  config = loadConfig(process.env, process.cwd(), homedir());
} catch (error) {
  process.stderr.write(`[worldmachine-mcp] error: ${(error as Error).message}\n`);
  process.exit(1);
}

const logger = createLogger(config.logLevel);
const session = new WorldMachineSession({
  executable: resolveExecutable(config.bin),
  defaultProject: config.defaultProject,
  pathPolicy: new FsPathPolicy(config.allowedRoots),
  commandTimeoutMs: config.commandTimeoutMs,
  idleTimeoutMs: config.idleTimeoutMs,
  logger,
  startProcess: (bin, signal) =>
    WorldMachineProcess.start({ bin, readyTimeoutMs: READY_TIMEOUT_MS, logger, signal }),
});
const reader = new WorldMachineGraphReader(session);

const handle = serveStdio(() =>
  createMcpServer({
    version,
    getStatus: new GetStatusService(session),
    listDevices: new ListDevicesService(session, reader),
    currentSession: () => session.status().session,
  }),
);

let stopping: Promise<void> | undefined;
function stop(reason: string): Promise<void> {
  stopping ??= (async () => {
    logger.debug(`Stopping: ${reason}`);
    await session.shutdown();
    await handle.close();
    process.exit(0);
  })();
  return stopping;
}

process.stdin.once('end', () => void stop('stdin closed'));
process.once('SIGINT', () => void stop('SIGINT'));
process.once('SIGTERM', () => void stop('SIGTERM'));
