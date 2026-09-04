import { proxyStudioQrRequest } from "../src/lib/qrProxy";

export const config = { runtime: "edge" };

export default function handler(req: Request): Promise<Response> {
  return proxyStudioQrRequest(req);
}
