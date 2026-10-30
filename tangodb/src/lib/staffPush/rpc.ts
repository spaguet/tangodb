import { supabase } from "../supabase";

type RpcResult = { data: unknown; error: { message: string } | null };

/** RPC names not yet in generated Database types (run db:gen-types after migration). */
export async function staffPushRpc(
  fn: "register_crm_staff_push_device" | "revoke_crm_staff_push_device",
  args: Record<string, string>
): Promise<RpcResult> {
  const client = supabase as unknown as {
    rpc: (name: string, params: Record<string, string>) => Promise<RpcResult>;
  };
  return client.rpc(fn, args);
}
