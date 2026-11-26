/**
 * One compressing proxy, put in front of every target for the browser stage.
 *
 * Rule 4 of the spec is that no app compresses: the harness does, identically. Asking each server directly
 * from a browser breaks that without anyone deciding to — `vite preview`, which serves TanStack Start, gzips
 * a static file for any client that accepts it, and the other two send theirs raw. Over a throttled link
 * that is a threefold difference in bytes that has nothing to do with the frameworks.
 *
 * So the browser talks to this instead. It asks the server for an uncompressed response, whatever the browser
 * offered, and gzips what comes back the same way for all four — flushing per chunk, so a streamed response
 * still arrives as it is produced. It is what a CDN in front of the origin would do, and it costs each target
 * the same.
 */
import http from 'node:http';
import zlib from 'node:zlib';

const COMPRESSIBLE = /^(?:text\/|application\/(?:javascript|json|xml|x-component)|image\/svg\+xml)/;

export function startEdge(origin, port) {
  const upstream = new URL(origin);
  const agent = new http.Agent({ keepAlive: true });
  const server = http.createServer((request, response) => {
    const proxied = http.request(
      {
        host: upstream.hostname,
        port: upstream.port,
        method: request.method,
        path: request.url,
        agent,
        // The browser's own `Host` goes through, as a reverse proxy sends it: a framework that checks a
        // mutation's `Origin` against the host it was asked for (Next does) has to see the two agree.
        headers: { ...request.headers, 'x-forwarded-host': request.headers.host, 'accept-encoding': 'identity' },
      },
      (answer) => {
        const headers = { ...answer.headers };
        const compress =
          COMPRESSIBLE.test(String(headers['content-type'] ?? '')) &&
          !headers['content-encoding'] &&
          request.method !== 'HEAD' &&
          answer.statusCode !== 304;
        if (!compress) {
          response.writeHead(answer.statusCode, headers);
          answer.pipe(response);
          return;
        }
        delete headers['content-length'];
        headers['content-encoding'] = 'gzip';
        headers.vary = headers.vary ? `${headers.vary}, Accept-Encoding` : 'Accept-Encoding';
        response.writeHead(answer.statusCode, headers);
        const gzip = zlib.createGzip({ level: 6, flush: zlib.constants.Z_SYNC_FLUSH });
        answer.pipe(gzip).pipe(response);
      },
    );
    proxied.on('error', () => {
      if (!response.headersSent) response.writeHead(502);
      response.end();
    });
    request.pipe(proxied);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () =>
      resolve({
        base: `http://127.0.0.1:${port}`,
        stop: () =>
          new Promise((done) => {
            agent.destroy();
            server.closeAllConnections();
            server.close(done);
          }),
      }),
    );
  });
}
