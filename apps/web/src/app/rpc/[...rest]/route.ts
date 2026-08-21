import { createContext } from "@forkhub/api/context";
import { appRouter } from "@forkhub/api/routers/index";
import { onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";

const rpcHandler = new RPCHandler(appRouter, {
  interceptors: [
    onError((error) => {
      console.error(error);
    }),
  ],
});

async function handle(request: Request) {
  const { response } = await rpcHandler.handle(request, {
    prefix: "/rpc",
    context: await createContext({ context: undefined }),
  });
  return response ?? new Response("Not Found", { status: 404 });
}

export const GET = handle;
export const POST = handle;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
