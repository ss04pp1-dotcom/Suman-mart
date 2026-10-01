// Pure helpers with zero platform or framework dependencies.

/** Identity cast used by route bodies after zod has validated the payload. */
export function parseBody<T>(raw: unknown): T {
  return raw as T;
}
