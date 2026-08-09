import { createServer, type Server } from 'node:http';

export interface ServiceStatus {
  discordReady: boolean;
  recording: boolean;
}

export function startWebServer(port: number, getStatus: () => ServiceStatus): Server {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');

    if (request.method === 'GET' && url.pathname === '/') {
      response.statusCode = 200;
      response.end(JSON.stringify({ service: 'govspark-discord-recorder', ...getStatus() }));
      return;
    }

    if (request.method === 'GET' && url.pathname === '/healthz') {
      const status = getStatus();
      response.statusCode = status.discordReady ? 200 : 503;
      response.end(JSON.stringify({ healthy: status.discordReady, ...status }));
      return;
    }

    response.statusCode = 404;
    response.end(JSON.stringify({ error: 'Not Found' }));
  });

  server.listen(port, '0.0.0.0', () => {
    console.info(`HTTP server listening on 0.0.0.0:${port}`);
  });
  return server;
}

export async function closeWebServer(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}
