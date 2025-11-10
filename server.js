const http = require('http');
const path = require('path');
const fs = require('fs');
const url = require('url');
const zlib = require('zlib');

const authHandler = require('./api/auth.js');

const PORT = process.env.PORT || 3000;
const ROOT_DIR = __dirname;

const server = http.createServer(async (req, res) => {
  if (req.url.startsWith('/api/auth')) {
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

  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`Smart Movie Match server running at http://localhost:${PORT}`);
});

function serveStatic(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405;
    applySecurityHeaders(res);
    res.setHeader('Allow', 'GET, HEAD');
    res.setHeader('Cache-Control', 'no-cache');
    res.end('Method not allowed');
    return;
  }

  const parsed = url.parse(req.url);
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

    const etag = generateETag(stats);
    const lastModified = stats.mtime.toUTCString();
    const cacheControl = getCacheControl(filePath);
    const contentType = getContentType(filePath);

    applySecurityHeaders(res);
    res.setHeader('Content-Type', contentType);
    if (cacheControl) {
      res.setHeader('Cache-Control', cacheControl);
    }
    if (etag) {
      res.setHeader('ETag', etag);
    }
    res.setHeader('Last-Modified', lastModified);
    addVaryHeader(res, 'Accept-Encoding');

    if (isFresh(req, etag, stats.mtime)) {
      res.statusCode = 304;
      res.end();
      return;
    }

    res.statusCode = 200;

    if (req.method === 'HEAD') {
      res.end();
      return;
    }

    const stream = fs.createReadStream(filePath);
    stream.on('error', () => {
      res.statusCode = 500;
      applySecurityHeaders(res);
      res.setHeader('Cache-Control', 'no-cache');
      res.end('Server error');
    });

    const compressionStream = createCompressionStream(req, res, filePath);
    if (compressionStream) {
      stream.pipe(compressionStream).pipe(res);
    } else {
      stream.pipe(res);
    }
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
  const baseName = path.basename(filePath);
  const hasHash = /(?:\.|-|_)[a-f0-9]{8,}(?=\.|$)/.test(baseName);
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
    if (hasHash) {
      return 'public, max-age=31536000, immutable';
    }
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

function generateETag(stats) {
  const mtime = stats.mtimeMs.toString(16);
  const size = stats.size.toString(16);
  return `W/"${size}-${mtime}"`;
}

function isFresh(req, etag, mtime) {
  const ifNoneMatchHeader = req.headers['if-none-match'];
  if (etag && typeof ifNoneMatchHeader === 'string') {
    const matches = ifNoneMatchHeader
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    if (matches.includes(etag) || matches.includes('*')) {
      return true;
    }
  }

  const ifModifiedSince = req.headers['if-modified-since'];
  if (ifModifiedSince) {
    const sinceTime = new Date(ifModifiedSince);
    if (!Number.isNaN(sinceTime.getTime())) {
      if (mtime <= sinceTime) {
        return true;
      }
    }
  }

  return false;
}

function addVaryHeader(res, value) {
  const existing = res.getHeader('Vary');
  if (!existing) {
    res.setHeader('Vary', value);
    return;
  }
  const values = new Set(
    existing
      .toString()
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  );
  values.add(value);
  res.setHeader('Vary', Array.from(values).join(', '));
}

function createCompressionStream(req, res, filePath) {
  if (!shouldCompress(filePath)) {
    return null;
  }

  const acceptEncoding = req.headers['accept-encoding'] || '';

  if (typeof zlib.createBrotliCompress === 'function' && /\bbr\b/.test(acceptEncoding)) {
    res.setHeader('Content-Encoding', 'br');
    res.removeHeader('Content-Length');
    const brotliOptions = {};
    if (zlib.constants && typeof zlib.constants.BROTLI_PARAM_QUALITY === 'number') {
      brotliOptions.params = {
        [zlib.constants.BROTLI_PARAM_QUALITY]: 4
      };
    }
    return zlib.createBrotliCompress(brotliOptions);
  }

  if (/\bgzip\b/.test(acceptEncoding)) {
    res.setHeader('Content-Encoding', 'gzip');
    res.removeHeader('Content-Length');
    return zlib.createGzip({ level: zlib.constants.Z_BEST_SPEED });
  }

  return null;
}

function shouldCompress(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const compressibleExts = new Set([
    '.html',
    '.css',
    '.js',
    '.json',
    '.svg',
    '.xml',
    '.txt',
    '.ico'
  ]);
  return compressibleExts.has(ext);
}
