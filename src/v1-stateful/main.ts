// Run the v1 (stateful) server on its own: `npm run start:v1`
import { createV1Server } from "./server.ts";

const port = Number(process.env.PORT ?? 3000);
createV1Server().listen(port, () => {
  console.log(`v1 (stateful) MCP server on http://localhost:${port}`);
});
