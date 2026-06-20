import worker from "../../src/worker.js";

export async function onRequest(context) {
  return worker.fetch(context.request, {
    ...context.env,
    ASSETS: {
      fetch: () => new Response("Not found", { status: 404 }),
    },
  });
}
