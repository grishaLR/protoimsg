import { Router, type Request, type Response } from 'express';
import https from 'node:https';
import http from 'node:http';

const ALLOWED_HOSTS = new Set(['audio.plyr.fm', 'cdn.plyr.fm', 'plyr.fm']);

function isAllowedUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return (u.protocol === 'https:' || u.protocol === 'http:') && ALLOWED_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}

export function audioProxyRouter(): Router {
  const router = Router();

  router.get('/', (req: Request, res: Response) => {
    const url = req.query['url'];
    if (typeof url !== 'string' || !isAllowedUrl(url)) {
      res.status(400).json({ error: 'Invalid or disallowed URL' });
      return;
    }

    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;

    const upstream = lib.get(url, (upRes) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET');
      res.setHeader('Cache-Control', 'public, max-age=3600');

      const ct = upRes.headers['content-type'];
      if (ct) res.setHeader('Content-Type', ct);
      const cl = upRes.headers['content-length'];
      if (cl) res.setHeader('Content-Length', cl);
      const cr = upRes.headers['content-range'];
      if (cr) res.setHeader('Content-Range', cr);
      const ar = upRes.headers['accept-ranges'];
      if (ar) res.setHeader('Accept-Ranges', ar);

      res.status(upRes.statusCode ?? 200);
      upRes.pipe(res);
    });

    upstream.on('error', () => {
      if (!res.headersSent) res.status(502).json({ error: 'Upstream fetch failed' });
    });

    req.on('close', () => upstream.destroy());
  });

  return router;
}
