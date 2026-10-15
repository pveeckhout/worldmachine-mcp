import { describe, expect, it } from 'vitest';
import { WorldMachineError } from '../../src/domain/errors.js';
import { fillTemplate } from '../../src/domain/graph-template.js';

const PATH = '/roots/hills.json';

function refusal(file: unknown, args: Record<string, string | number | boolean> = {}): string {
  try {
    fillTemplate(file, args, PATH);
  } catch (error) {
    if (error instanceof WorldMachineError && error.code === 'REFUSED') return error.message;
    throw error;
  }
  throw new Error('fillTemplate accepted the template');
}

const TEMPLATE = {
  template: 1,
  description: 'hills',
  parameters: {
    resolution: { type: 'integer', default: 1025 },
    seed: { type: 'integer' },
    name: { type: 'string', default: 'Base' },
    rough: { type: 'number', default: 0.5 },
    on: { type: 'boolean', default: true },
  },
  spec: {
    version: 1,
    scene: { resolution: { $param: 'resolution' } },
    devices: [
      {
        name: { $param: 'name' },
        type: 'Advanced Perlin',
        enabled: { $param: 'on' },
        parameters: { seed: { $param: 'seed' }, roughness: { $param: 'rough' } },
      },
      { name: 'Eroded', type: 'Erosion', inputs: { '1': { $param: 'name' } } },
    ],
  },
};

describe('fillTemplate (templates design section 2)', () => {
  it('fills references at any depth, with defaults and overrides', () => {
    expect(fillTemplate(TEMPLATE, { seed: 7, rough: 0.25 }, PATH)).toEqual({
      version: 1,
      scene: { resolution: 1025 },
      devices: [
        { name: 'Base', type: 'Advanced Perlin', enabled: true, parameters: { seed: 7, roughness: 0.25 } },
        { name: 'Eroded', type: 'Erosion', inputs: { '1': 'Base' } },
      ],
    });
  });

  it('fills a reference inside an array (Review Focus 1)', () => {
    const file = {
      template: 1,
      parameters: { old: { type: 'string' } },
      spec: { version: 1, devices: [], remove: [{ $param: 'old' }] },
    };
    expect(fillTemplate(file, { old: 'Old Noise' }, PATH)).toEqual({
      version: 1,
      devices: [],
      remove: ['Old Noise'],
    });
  });

  it('reads a file without a template key as a plain spec', () => {
    const spec = { version: 1, devices: [{ name: 'Base', type: 'Gradient' }] };
    expect(fillTemplate(spec, {}, PATH)).toEqual(spec);
  });

  it('does not change the file it was given', () => {
    const copy = structuredClone(TEMPLATE);
    fillTemplate(TEMPLATE, { seed: 1 }, PATH);
    expect(TEMPLATE).toEqual(copy);
  });

  it.each<[string, unknown, Record<string, string | number | boolean>, string]>([
    ['not an object', [1, 2], {}, `${PATH}: a template must be a JSON object`],
    [
      'template other than 1',
      { template: 2, spec: { version: 1, devices: [] } },
      {},
      `${PATH}: template must be 1, not 2`,
    ],
    ['no spec', { template: 1 }, {}, `${PATH}: a template needs a spec`],
    [
      'parameters not an object',
      { template: 1, parameters: [], spec: {} },
      {},
      `${PATH}: parameters must be an object`,
    ],
    [
      'a declaration that is not an object',
      { template: 1, parameters: { a: 'integer' }, spec: { x: { $param: 'a' } } },
      { a: 1 },
      `${PATH}: parameter 'a' must be an object with a type`,
    ],
    [
      'an unknown type',
      { template: 1, parameters: { a: { type: 'float' } }, spec: { x: { $param: 'a' } } },
      { a: 1 },
      `${PATH}: parameter 'a' has type 'float'; the types are number, integer, string, and boolean`,
    ],
    [
      'a default of another type',
      { template: 1, parameters: { a: { type: 'integer', default: 1.5 } }, spec: { x: { $param: 'a' } } },
      {},
      `${PATH}: parameter 'a': the default 1.5 is not an integer`,
    ],
    [
      'an undeclared reference',
      { template: 1, spec: { x: { $param: 'b' } } },
      {},
      `${PATH}: spec.x refers to parameter 'b', which is not declared`,
    ],
    [
      '$param beside other keys',
      { template: 1, parameters: { a: { type: 'string' } }, spec: { x: { $param: 'a', y: 1 } } },
      { a: 's' },
      `${PATH}: spec.x has $param beside other keys`,
    ],
    [
      '$param that is not a string',
      { template: 1, spec: { x: { $param: 3 } } },
      {},
      `${PATH}: spec.x has a $param that is not a parameter name`,
    ],
    [
      'a declared parameter never used',
      { template: 1, parameters: { a: { type: 'string', default: 's' } }, spec: { x: 1 } },
      {},
      `${PATH}: parameter 'a' is declared but no $param uses it`,
    ],
    [
      'an undeclared argument',
      { template: 1, spec: { x: 1 } },
      { a: 1 },
      `${PATH}: argument 'a' is not a parameter of this template`,
    ],
    [
      'a missing argument',
      { template: 1, parameters: { a: { type: 'integer' } }, spec: { x: { $param: 'a' } } },
      {},
      `${PATH}: parameter 'a' needs an argument; it has no default`,
    ],
    [
      'an integer argument of 1.5',
      { template: 1, parameters: { a: { type: 'integer' } }, spec: { x: { $param: 'a' } } },
      { a: 1.5 },
      `${PATH}: argument 'a' must be an integer, not 1.5`,
    ],
    [
      'a string for a number',
      { template: 1, parameters: { a: { type: 'number' } }, spec: { x: { $param: 'a' } } },
      { a: '2' },
      `${PATH}: argument 'a' must be a number, not "2"`,
    ],
  ])('refuses %s', (_name, file, args, message) => {
    expect(refusal(file, args)).toBe(message);
  });

  it('refuses an argument that is not a scalar (Review Focus 2)', () => {
    const file = { template: 1, parameters: { a: { type: 'string' } }, spec: { x: { $param: 'a' } } };
    expect(refusal(file, { a: { $param: 'a' } as unknown as string })).toBe(
      `${PATH}: argument 'a' must be a string, not {"$param":"a"}`,
    );
  });

  it('refuses a non-finite number argument', () => {
    const file = { template: 1, parameters: { a: { type: 'number' } }, spec: { x: { $param: 'a' } } };
    expect(refusal(file, { a: Number.POSITIVE_INFINITY })).toBe(
      `${PATH}: argument 'a' must be a number, not Infinity`,
    );
  });

  it('refuses a $param in a file without a template key', () => {
    expect(refusal({ version: 1, devices: [], x: { $param: 'a' } })).toBe(
      `${PATH}: spec.x refers to parameter 'a', which is not declared`,
    );
  });

  it('fills a declared constructor from its default, not from Object.prototype', () => {
    const file = {
      template: 1,
      parameters: { constructor: { type: 'string', default: 'd' } },
      spec: { x: { $param: 'constructor' } },
    };
    expect(fillTemplate(file, {}, PATH)).toEqual({ x: 'd' });
  });

  it('refuses a declared toString with no default and no argument', () => {
    const file = {
      template: 1,
      parameters: { toString: { type: 'string' } },
      spec: { x: { $param: 'toString' } },
    };
    expect(refusal(file)).toBe(`${PATH}: parameter 'toString' needs an argument; it has no default`);
  });

  it('fills a declared __proto__ key from JSON.parse', () => {
    const file = JSON.parse(
      '{"template":1,"parameters":{"__proto__":{"type":"string","default":"d"}},"spec":{"x":{"$param":"__proto__"}}}',
    );
    expect(fillTemplate(file, {}, PATH)).toEqual({ x: 'd' });
  });

  it('keeps false and 0 arguments over defaults', () => {
    const file = {
      template: 1,
      parameters: { on: { type: 'boolean', default: true }, n: { type: 'integer', default: 5 } },
      spec: { on: { $param: 'on' }, n: { $param: 'n' } },
    };
    expect(fillTemplate(file, { on: false, n: 0 }, PATH)).toEqual({ on: false, n: 0 });
  });
});
