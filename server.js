const http = require('http');
const path = require('path');
const fs = require('fs');
const url = require('url');

const authHandler = require('./api/auth.js');
const tmdbHandler = require('./api/tmdb.js');
const omdbHandler = require('./api/omdb.js');
const youtubeHandler = require('./api/youtube.js');

const apiHandlers = new Map([
  ['/api/tmdb', tmdbHandler],
  ['/api/omdb', omdbHandler],
  ['/api/youtube', youtubeHandler]
]);

const PORT = process.env.PORT || 3000;
const ROOT_DIR = __dirname;

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname || '/';

  if (pathname === '/api/auth') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        req.connection.destroy();
      }
    });
    req.on('end', async () => {
      try {
        if (body) {
          try {
            req.body = JSON.parse(body);
          } catch (error) {
            req.body = body;
          }
        } else {
          req.body = {};
        }
        await authHandler(req, wrapResponse(res));
      } catch (error) {
        console.error('Unhandled auth error', error);
        if (!res.headersSent) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Auth service crashed unexpectedly.' }));
        }
      }
    });
    return;
  }

  const handler = apiHandlers.get(pathname);
  if (handler) {
    try {
      req.query = parsedUrl.query || {};
      await handler(req, wrapResponse(res));
    } catch (error) {
      console.error(`Unhandled API error for ${pathname}`, error);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'API service crashed unexpectedly.' }));
      }
    }
    return;
  }

  serveStatic(req, res, parsedUrl);
});

server.listen(PORT, () => {
  console.log(`Smart Movie Match server running at http://localhost:${PORT}`);
});

function serveStatic(req, res, parsed = url.parse(req.url)) {
  let pathname = decodeURIComponent(parsed.pathname);
  if (pathname === '/') {
    pathname = '/index.html';
  }
  const filePath = path.join(ROOT_DIR, pathname);
  if (!filePath.startsWith(ROOT_DIR)) {
    res.statusCode = 403;
    applySecurityHeaders(res);
    res.setHeader('Cache-Control', 'no-cache');
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.statusCode = 404;
      applySecurityHeaders(res);
      res.setHeader('Cache-Control', 'no-cache');
      res.end('Not found');
      return;
    }

    const stream = fs.createReadStream(filePath);
    stream.on('error', () => {
      res.statusCode = 500;
      applySecurityHeaders(res);
      res.setHeader('Cache-Control', 'no-cache');
      res.end('Server error');
    });
    res.statusCode = 200;
    applySecurityHeaders(res);
    res.setHeader('Content-Type', getContentType(filePath));
    const cacheControl = getCacheControl(filePath);
    if (cacheControl) {
      res.setHeader('Cache-Control', cacheControl);
    }
    stream.pipe(res);
  });
}

function wrapResponse(res) {
  return {
    status(statusCode) {
      res.statusCode = statusCode;
      return this;
    },
    json(payload) {
      if (!res.headersSent) {
        res.setHeader('Content-Type', 'application/json');
      }
      res.end(JSON.stringify(payload));
    },
    setHeader(name, value) {
      res.setHeader(name, value);
    }
  };
}

function getContentType(filePath) {
  const ext = path.extname(filePath);
  switch (ext) {
    case '.html':
      return 'text/html; charset=UTF-8';
    case '.css':
      return 'text/css; charset=UTF-8';
    case '.js':
      return 'application/javascript; charset=UTF-8';
    case '.json':
      return 'application/json; charset=UTF-8';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.svg':
      return 'image/svg+xml';
    default:
      return 'application/octet-stream';
  }
}

function getCacheControl(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.html') {
    return 'no-cache, no-store, must-revalidate';
  }

  const longCacheExts = new Set([
    '.css',
    '.js',
    '.png',
    '.jpg',
    '.jpeg',
    '.svg',
    '.webp',
    '.ico',
    '.woff',
    '.woff2'
  ]);

  if (longCacheExts.has(ext)) {
    return 'public, max-age=86400, stale-while-revalidate=604800';
  }

  return 'public, max-age=600';
}

function applySecurityHeaders(res) {
  const existingCsp = res.getHeader('Content-Security-Policy');
  const baseCsp =
    "default-src 'self'; " +
    "img-src 'self' data: https://image.tmdb.org https://m.media-amazon.com https://img.omdbapi.com; " +
    "script-src 'self'; " +
    "style-src 'self' 'unsafe-inline'; " +
    "connect-src 'self'; " +
    "frame-src https://www.youtube.com https://www.youtube-nocookie.com; " +
    "media-src 'self'; " +
    "font-src 'self'; " +
    "base-uri 'self'; " +
    "form-action 'self'";

  if (!existingCsp) {
    res.setHeader('Content-Security-Policy', baseCsp);
  }

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer-when-downgrade');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
}
