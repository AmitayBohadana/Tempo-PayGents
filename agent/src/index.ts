import { createServer } from "./server.js";

async function bootstrap() {
  const { app, port } = await createServer();
  app.listen(port, () => {
    console.log(`[agent] server listening on http://localhost:${port}`);
  });
}

bootstrap().catch((error) => {
  console.error("[agent] bootstrap failed", error);
  process.exit(1);
});
