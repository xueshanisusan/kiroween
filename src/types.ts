/** Success-or-error result used across the pipeline instead of throwing. */
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };
