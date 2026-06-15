const TOKEN_RE =
  /\*+|[+-]?(?:NaN|Infinity|Inf)|[+-]?(?:(?:\d+\.?\d*)|(?:\.\d+))(?:\s*[eEdD]\s*[+-]?\d+)?/gi;

export function parseFortranNumbers(line: string): number[] {
  const matches = line.match(TOKEN_RE) ?? [];
  return matches.map(parseFortranNumber);
}

export function parseFortranNumber(token: string): number {
  const normalized = token.trim().replace(/\s+/g, "").replace(/[dD]/g, "e");
  if (/^\*+$/.test(normalized) || /^[-+]?nan$/i.test(normalized)) return Number.NaN;
  if (/^[+]?inf(?:inity)?$/i.test(normalized)) return Number.POSITIVE_INFINITY;
  if (/^-inf(?:inity)?$/i.test(normalized)) return Number.NEGATIVE_INFINITY;
  const value = Number.parseFloat(normalized);
  return Object.is(value, -0) ? 0 : value;
}
