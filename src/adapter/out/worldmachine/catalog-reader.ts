import type { EnumCatalog, PortTypeCatalog, PortTypeCatalogEntry } from '../../../domain/catalog.js';

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

/** An own entry only: JSON-parsed records still inherit `constructor` and `toString`. */
const has = (record: Json, key: string): boolean => Object.hasOwn(record, key);

function objectField(parent: Json, key: string, what: string): Json {
  const value = parent[key];
  if (!isObject(value)) throw new Error(`${what}: ${key} must be an object`);
  return value;
}

function readPorts(
  type: Json,
  side: 'inputs' | 'outputs',
  classes: Json,
  name: string,
): readonly PortTypeCatalogEntry[] {
  const ports = type[side];
  const label = side === 'inputs' ? 'input' : 'output';
  if (!Array.isArray(ports)) throw new Error(`type '${name}': ${side} must be an array`);
  return ports.map((port: unknown, index) => {
    if (!isObject(port) || typeof port.name !== 'string' || typeof port.class !== 'string') {
      throw new Error(`type '${name}' ${label} ${index + 1}: needs a name and a class`);
    }
    const number = port.port;
    if (typeof number !== 'number' || !Number.isInteger(number) || number <= 0) {
      throw new Error(`type '${name}' ${label} ${index + 1}: port must be a positive integer`);
    }
    if (!has(classes, port.class)) {
      throw new Error(`type '${name}' ${label} ${number}: no ${label} class '${port.class}'`);
    }
    return { port: number, name: port.name, class: port.class };
  });
}

/** Validates a parsed port-type catalog; throws an Error naming the first fault. */
export function readPortTypeCatalog(json: unknown): PortTypeCatalog {
  if (!isObject(json)) throw new Error('port-type catalog is not an object');
  const { build, kind } = json;
  if (typeof build !== 'number' || !Number.isInteger(build) || build <= 0) {
    throw new Error('build must be a positive integer');
  }
  if (kind !== 'strict' && kind !== 'sample-derived') {
    throw new Error("kind must be 'strict' or 'sample-derived'");
  }
  const outputClasses = objectField(json, 'outputClasses', 'port-type catalog');
  for (const [id, value] of Object.entries(outputClasses)) {
    if (typeof value !== 'string') throw new Error(`output class '${id}': name must be a string`);
  }
  const inputClasses = objectField(json, 'inputClasses', 'port-type catalog');
  for (const [id, accepted] of Object.entries(inputClasses)) {
    if (!isStringArray(accepted)) throw new Error(`input class '${id}': must be an array of strings`);
    for (const output of accepted) {
      if (!has(outputClasses, output)) throw new Error(`input class '${id}': no output class '${output}'`);
    }
  }
  const types = objectField(json, 'types', 'port-type catalog');
  for (const [name, type] of Object.entries(types)) {
    if (!isObject(type)) throw new Error(`type '${name}': must be an object`);
    if (!isStringArray(type.added)) throw new Error(`type '${name}': added must be an array of strings`);
    readPorts(type, 'inputs', inputClasses, name);
    readPorts(type, 'outputs', outputClasses, name);
  }
  return json as PortTypeCatalog;
}

/** Validates a parsed enum catalog; throws an Error naming the first fault. */
export function readEnumCatalog(json: unknown): EnumCatalog {
  if (!isObject(json)) throw new Error('enum catalog is not an object');
  if (typeof json.build !== 'number' || !Number.isInteger(json.build)) {
    throw new Error('build must be an integer');
  }
  const types = objectField(json, 'types', 'enum catalog');
  for (const [name, type] of Object.entries(types)) {
    if (!isObject(type)) throw new Error(`type '${name}': must be an object`);
    if (!isStringArray(type.parameters)) {
      throw new Error(`type '${name}': parameters must be an array of strings`);
    }
    if (!isObject(type.enums)) throw new Error(`type '${name}': enums must be an object`);
    for (const [row, labels] of Object.entries(type.enums)) {
      if (!isStringArray(labels)) {
        throw new Error(`type '${name}': enums '${row}' must be an array of strings`);
      }
    }
  }
  return json as EnumCatalog;
}
