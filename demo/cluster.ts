// Fake "production": N server replicas behind a round-robin load balancer.
// Request 1 -> replica A, request 2 -> replica B, request 3 -> replica C, repeat.
// No sticky sessions. This is exactly where v1 falls over.

import { createServer, request, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export type Cluster = { url: string; close: () => Promise<void> };

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => server.listen(0, () => resolve((server.address() as AddressInfo).port)));
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

/** Start the replicas plus a load balancer. Returns the load balancer's URL. */
export async function startCluster(replicas: Server[]): Promise<Cluster> {
  const ports = await Promise.all(replicas.map(listen));
  const names = ports.map((_, i) => String.fromCharCode(65 + i)); // A, B, C...
  let next = 0;

  const balancer = createServer((clientReq, clientRes) => {
    const i = next++ % ports.length;

    // Forward the request untouched to the chosen replica.
    const upstream = request(
      { port: ports[i], path: clientReq.url, method: clientReq.method, headers: clientReq.headers },
      (upstreamRes) => {
        // Tag the response so the demo can print which replica answered.
        clientRes.writeHead(upstreamRes.statusCode ?? 502, { ...upstreamRes.headers, "x-replica": names[i] });
        upstreamRes.pipe(clientRes);
      },
    );
    clientReq.pipe(upstream);
  });

  const lbPort = await listen(balancer);
  return {
    url: `http://localhost:${lbPort}`,
    close: async () => {
      await Promise.all([balancer, ...replicas].map(close));
    },
  };
}
