#!/usr/bin/env node
/* ============================================================
   Lokal CORS-Proxy für Spotify API
   Nur: node proxy/local.js  (Port 8001, konfigurierbar)
   Kein npm, kein Account, kein Deployment.
   ============================================================
   Nutzung:
     1. In Terminal:  node proxy/local.js
     2. In der App:   CORS-Proxy-URL = http://localhost:8001
     3. Spielen.
     4. Fertig:       Ctrl+C im Terminal.

   Mixed Content (https-Seite → http://localhost): wird von
   Chrome/Firefox/Safari erlaubt, da localhost als sicher gilt.
   ============================================================ */

'use strict';

const http = require('http');
const https = require('https');

const PORT = parseInt(process.argv[2] || '8001', 10);
const HOST = '127.0.0.1';
const UPSTREAM = 'api.spotify.com';

const server = http.createServer((req, res) => {
  // CORS Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders());
    return res.end();
  }

  // Body sammeln (PUT/POST)
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);

    // Ziel-URL zusammenbauen
    const targetPath = req.url; // z.B. /v1/search?q=genre:pop&type=track
    const options = {
      hostname: UPSTREAM,
      port: 443,
      path: targetPath,
      method: req.method,
      headers: {
        'Authorization': req.headers['authorization'] || '',
        'Content-Type': req.headers['content-type'] || '',
        'Accept': 'application/json',
      },
    };
    if (body.length) options.headers['Content-Length'] = body.length;

    const upstream = https.request(options, (upRes) => {
      // Response-Header an den Browser durchreichen
      const headers = corsHeaders();
      const ct = upRes.headers['content-type'];
      if (ct) headers['Content-Type'] = ct;
      const cl = upRes.headers['content-length'];
      if (cl) headers['Content-Length'] = cl;

      // *** Der entscheidende Teil: Retry-After lesbar machen ***
      const ra = upRes.headers['retry-after'];
      if (ra) {
        headers['Retry-After'] = ra;
        headers['Access-Control-Expose-Headers'] =
          'Retry-After, Content-Type, Content-Length';
        console.log(`  ↻ Retry-After: ${ra} s  (${req.method} ${targetPath.slice(0, 60)})`);
      }

      res.writeHead(upRes.statusCode, headers);
      upRes.pipe(res);
    });

    upstream.on('error', (e) => {
      console.error('  ✗ Upstream-Fehler:', e.message);
      res.writeHead(502, { 'Content-Type': 'application/json', ...corsHeaders() });
      res.end(JSON.stringify({ error: { message: 'Proxy: ' + e.message } }));
    });

    if (body.length) upstream.write(body);
    upstream.end();
  });
});

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

server.listen(PORT, HOST, () => {
  console.log('');
  console.log('  🎧 Spotify CORS-Proxy (lokal)');
  console.log(`  ┌─────────────────────────────────────────`);
  console.log(`  │ Läuft auf:  http://localhost:${PORT}`);
  console.log(`  │ Ziel:       https://${UPSTREAM}`);
  console.log(`  │`);
  console.log(`  │ In der App eintragen als Proxy-URL:`);
  console.log(`  │   http://localhost:${PORT}`);
  console.log(`  │`);
  console.log(`  │ Beenden:    Ctrl+C`);
  console.log(`  └─────────────────────────────────────────`);
  console.log('');
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} ist belegt. Versuche:  node proxy/local.js 8002`);
    process.exit(1);
  }
  throw e;
});
