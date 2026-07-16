const LOG_VALUE_LIMIT = 1_000;

/**
 * Keep externally influenced values on one bounded line before they reach a
 * platform log. The format string itself must remain a static literal.
 */
export function sanitizeLogValue(value: unknown) {
  const text = value instanceof Error
    ? `${value.name}: ${value.message}`
    : String(value);
  return text.replace(/[\n\r\u2028\u2029]/g, " ").slice(0, LOG_VALUE_LIMIT);
}
