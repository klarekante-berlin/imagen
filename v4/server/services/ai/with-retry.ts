/** Retry an async op on 429 / 529 / 503 with exponential backoff.
 * Anthropic's overload errors (529) are common during peak hours and resolve
 * within a handful of seconds. Three tries with jitter is a good default. */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { tries?: number; baseMs?: number; label?: string } = {},
): Promise<T> {
  const tries = opts.tries ?? 4;
  const base = opts.baseMs ?? 1500;
  let lastErr: unknown;
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = (err as Error).message ?? "";
      const status = /\b(429|529|503|529 Overloaded|overloaded_error|rate_limit_error)\b/i.test(msg);
      if (!status || attempt === tries - 1) throw err;
      const delay = base * Math.pow(2, attempt) + Math.random() * 500;
      console.warn(
        `[v4 withRetry${opts.label ? ` ${opts.label}` : ""}] retry ${attempt + 1}/${tries - 1} after ${Math.round(delay)}ms — ${msg.slice(0, 120)}`,
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}
