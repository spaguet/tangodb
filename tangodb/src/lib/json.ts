import type { Json } from "../types/database";

export function asJson(value: unknown): Json {
  return value as Json;
}
