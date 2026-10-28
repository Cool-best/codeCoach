import type { ApiResult } from "../shared/types";

export async function unwrap<T>(request: Promise<ApiResult<T>>): Promise<T> {
  const result = await request;
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}
