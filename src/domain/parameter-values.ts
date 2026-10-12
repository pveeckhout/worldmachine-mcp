import type { Parameter } from './device.js';
import type { ParameterValue } from './graph-edit.js';
import { matchesLength, parseLength, showsLength } from './lengths.js';

// The forms this tool sends. World Machine accepts more (spec fact 35, raw/p2c-edits.txt l.182-240): exponent forms
// (`1e-1`), a leading dot (`.5`), enum labels in any case (`clamp`), and the bool words `no`, `on`, and `TRUE`. They
// are refused here so every value sent has one form checked against the reported type (spec section 7), not because
// World Machine rejects them.
/** Plain decimal notation; negative values included (`-0.5`, `-1`: raw/p2c-edits.txt l.182-192). */
const DECIMAL = /^-?\d+(?:\.\d+)?$/;
/** raw/v6b-param-set.txt l.117-118: World Machine rejects `3.0` for an `int`. */
const INTEGER = /^-?\d+$/;
/** Spec fact 18: `enum` takes a 0-based index; out of range is World Machine's to reject (raw/p2c-edits.txt l.218-219). */
const INDEX = /^\d+$/;
/** raw/v6b-param-set.txt l.126-157 (spec fact 18). */
const BOOL_WORDS = new Set(['true', 'false', '1', '0', 'yes', 'off']);

/** `String(value)` when that is plain decimal notation; undefined for exponent forms such as `1e-7`. */
export function decimalText(value: number): string | undefined {
  const text = String(value);
  return DECIMAL.test(text) ? text : undefined;
}

export type ParameterText = { readonly text: string } | { readonly problem: string };

const NUMBER_PROBLEM =
  "expected a plain decimal number in World Machine's internal units (no units, no decimal comma, no exponent)";

/**
 * The text `param set` gets for `value`, checked against the type `param list` reports (spec section 7, Plan 2c
 * decision D6). World Machine still decides on what passes, per item.
 */
export function parameterText(parameter: Parameter, value: ParameterValue): ParameterText {
  // Spec v2a section 6 (fact 55): a File Output with exportAlways set writes its file on every full build, which then
  // writes without the export check.
  if (parameter.name === 'exportAlways') {
    return { problem: 'exportAlways makes World Machine write output on every full build and cannot be set' };
  }
  switch (parameter.type) {
    case 'float':
      return numberText(value, DECIMAL, NUMBER_PROBLEM);
    case 'int':
      return numberText(value, INTEGER, 'expected an integer without a decimal point');
    case 'enum':
      return numberText(value, INDEX, 'expected the 0-based index of an option, such as 0 or 1');
    case 'bool':
      if (typeof value === 'boolean') return { text: String(value) };
      return typeof value === 'string' && BOOL_WORDS.has(value)
        ? { text: value }
        : { problem: 'expected true or false, or 1, 0, yes, or off' };
    case 'filename':
      // A filename sets where World Machine writes build output; paths are confined to the allowed roots only for
      // projects (spec section 9), so v1 refuses it.
      return { problem: 'filename parameters set where World Machine writes output and cannot be set' };
    case 'action':
      // raw/p2c-edits.txt l.251-252: `Parameter type not supported for console assignment.` (spec fact 36).
      return { problem: 'action parameters are buttons and cannot be set' };
    default:
      // Required, not cautious: an `other` parameter prints `Set ...` but keeps no value (raw/p2c-edits.txt
      // l.336-340, spec fact 36), so a confirmed set would report a change that did not happen.
      return { problem: `parameters of type '${parameter.type}' cannot be set` };
  }
}

/** A value as update_device_parameters takes it: `parameterText`'s result, or a length to convert (float-units design). */
export type ParameterInput =
  | ParameterText
  | { readonly length: { readonly given: string; readonly metres: number } };

const LENGTH_PROBLEM =
  'expected a plain decimal number in World Machine\'s internal units, or a length in m or km such as "500 m"';
const UNIT_PROBLEM = 'a unit is accepted only on a float that shows m or km';
/** Spec section 3, plan decision P9: a well-formed length whose metres a double cannot hold. */
const RANGE_PROBLEM = 'the length is out of range';
/**
 * Plan decision P4: a unit attempt is the whole value: a plain decimal, an optional single space, and a non-numeric
 * suffix that runs to the end without white space (`500 ft`, `3%`, `2 km2`). The suffix may not start with a digit,
 * white space, `.`, `,`, `+`, `-`, or an exponent (`1e-1`), so `1,5`, `1e-1`, `500  m`, ` 500 m`, and `500 m ` keep
 * `parameterText`'s own problem.
 */
const UNIT_ATTEMPT = /^-?\d+(?:\.\d+)? ?(?![eE][+-]?\d)[^\d\s.,+-]\S*$/;

/**
 * The value update_device_parameters sends, or a length to convert once the parameter's scale is read (float-units
 * design section 3). Every value that is not a unit attempt gets `parameterText`'s own result, so its path and its
 * problem text are unchanged; plan_graph and apply_graph keep `parameterText`, since units in graph specs are out of
 * scope (design section 1).
 */
export function parameterInput(parameter: Parameter, value: ParameterValue): ParameterInput {
  const plain = parameterText(parameter, value);
  if (parameter.type !== 'float' || 'text' in plain || typeof value !== 'string') return plain;
  if (!matchesLength(value)) return UNIT_ATTEMPT.test(value) ? { problem: LENGTH_PROBLEM } : plain;
  if (!showsLength(parameter.value)) return { problem: UNIT_PROBLEM };
  const metres = parseLength(value);
  return metres === undefined ? { problem: RANGE_PROBLEM } : { length: { given: value, metres } };
}

function numberText(value: ParameterValue, pattern: RegExp, problem: string): ParameterText {
  const text = typeof value === 'number' ? decimalText(value) : typeof value === 'string' ? value : undefined;
  return text !== undefined && pattern.test(text) ? { text } : { problem };
}
