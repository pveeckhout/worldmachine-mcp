// Float-units design section 3: a length is a plain decimal, an optional single space, and `m` or `km`. World Machine
// displays a length float in the same form (`8 km`, `3000 m`, `656.2 m`: raw/float-scale.txt l.1614 and l.860,
// raw/float-scale-default.txt l.114), so one pattern reads a client's length and a displayed value.
const LENGTH = /^(-?\d+(?:\.\d+)?) ?(m|km)$/;
/** A decimal that is zero as written (`0`, `-0`, `0.000`), so metres of 0 are not an underflow. */
const ZERO = /^-?0+(?:\.0+)?$/;
/** Design section 4: the internal value is written with at most this many significant digits. */
const SIGNIFICANT_DIGITS = 12;

/** `text` is written as a length (`500 m`, `2.5km`, `-4 km`), whether or not a double can hold it. */
export function matchesLength(text: string): boolean {
  return LENGTH.test(text);
}

/**
 * The metres of `text` written as a length, or undefined for any other text and for a length out of range: design
 * section 3 (plan decision P9), metres that are not finite, or zero while the decimal is not zero. A subnormal
 * non-zero count of metres is in range.
 */
export function parseLength(text: string): number | undefined {
  const match = LENGTH.exec(text);
  if (match === null) return undefined;
  const [, digits = '', unit] = match;
  const metres = Number(digits) * (unit === 'km' ? 1000 : 1);
  if (!Number.isFinite(metres) || (metres === 0 && !ZERO.test(digits))) return undefined;
  return metres;
}

/**
 * Design section 3: a unit is accepted only on a float whose listed value ends in ` m` or ` km`. Grammar only, so a
 * listed value a double cannot hold still shows a length (Codex round 4 ruling 2).
 */
export function showsLength(display: string): boolean {
  return matchesLength(display);
}

/**
 * `metres / scaleMetres` as the text `param set` gets (design section 4): plain decimal notation with at most twelve
 * significant digits, no exponent, trailing zeros dropped, and `0` for zero (plan decision P5). The division and the
 * rounding use JavaScript numbers, so an exact tie may round either way (design section 4). Undefined when the
 * quotient is out of range at this scale: not finite, or zero for a non-zero length (plan decision P9).
 */
export function internalText(metres: number, scaleMetres: number): string | undefined {
  const ratio = metres / scaleMetres;
  if (!Number.isFinite(ratio) || (ratio === 0 && metres !== 0)) return undefined;
  // toExponential(11) rounds to twelve significant digits: 0.0625 gives `6.25000000000e-2`.
  const [mantissa = '', exponent = '0'] = ratio.toExponential(SIGNIFICANT_DIGITS - 1).split('e');
  const negative = mantissa.startsWith('-');
  const digits = mantissa.replace('-', '').replace('.', '');
  if (/^0+$/.test(digits)) return '0';
  const point = Number(exponent) + 1;
  const plain =
    point <= 0
      ? `0.${'0'.repeat(-point)}${digits}`
      : point >= digits.length
        ? `${digits}${'0'.repeat(point - digits.length)}`
        : `${digits.slice(0, point)}.${digits.slice(point)}`;
  const trimmed = plain.includes('.') ? plain.replace(/0+$/, '').replace(/\.$/, '') : plain;
  return negative ? `-${trimmed}` : trimmed;
}
