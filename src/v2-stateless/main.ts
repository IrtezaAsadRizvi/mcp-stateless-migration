// Run the v2 (stateless) server on its own: `npm run start:v2`
import { createV2Server } from "./server.ts";

const port = Number(process.env.PORT ?? 3000);
createV2Server().listen(port, () => {
  console.log(`v2 (stateless) MCP server on http://localhost:${port}`);
});
