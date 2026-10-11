// Cloudflare Worker – Spotify API CORS-Proxy
// Deploy: Cloudflare Dashboard → Workers → New Worker
// Purpose: Den Retry-After-Header an den Browser durchreichen
//          (Spotify setzt kein Access-Control-Expose-Headers).
//
// Setup:
//   1. Worker deployen → du bekommst eine URL wie:
//      https://spotify-proxy.YOUR-SUBDOMAIN.workers.dev
//   2. In der Web-App: CORS-Proxy-URL Feld darauf setzen.
//
// Sicherheit: Der Worker leitet den Authorization-Header weiter,
// speichert aber NICHTS. Er ist ein stateless Pass-through.
// Optional: Ein simples Shared-Secret-Header-Check (siehe unten)
// schützt vor Missbrauch durch Dritte.

// Ggf. Shared Secret setzen (empfohlen, aber optional):
// In Cloudflare Worker → Settings → Variables: "SECRET" = "irgenwas-laengeres-zufalls"
// und in der App: PROXY_SECRET auf denselben Wert.
const SECRET = ''; // leeres String = kein Check

addEventListener('fetch', (event) => {
  event.respondWith(handle(event.request));
});

async function handle(req) {
  // CORS Preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: corsHeaders(),
    });
  }

  // Optionaler Secret-Check
  if (SECRET) {
    const hdr = req.headers.get('X-Proxy-Secret') || '';
    const urlSecret = new URL(req.url).searchParams.get('secret') || '';
    if (hdr !== SECRET && urlSecret !== SECRET) {
      return new Response('Forbidden', { status: 403 });
    }
  }

  // Ziel-URL: /v1/... → https://api.spotify.com/v1/...
  const url = new URL(req.url);
  const path = url.pathname; // z.B. /v1/me/player/devices
  const search = url.search; // z.B. ?q=genre:pop&type=track
  const target = 'https://api.spotify.com' + path + search;

  // Request-Header weiterleiten (nur die relevanten)
  const fwdHeaders = {
    'Authorization': req.headers.get('Authorization') || '',
    'Content-Type': req.headers.get('Content-Type') || '',
  };

  // Body für PUT/POST
  let body = null;
  if (req.method === 'PUT' || req.method === 'POST') {
    body = await req.text();
  }

  try {
    const resp = await fetch(target, {
      method: req.method,
      headers: fwdHeaders,
      body,
    });

    // Response mit CORS + Retry-After durchreichen
    const respHeaders = corsHeaders();
    // Kopiere relevante Spotify-Header
    const ct = resp.headers.get('Content-Type');
    if (ct) respHeaders['Content-Type'] = ct;

    // *** DER WICHTIGE TEIL ***
    const retryAfter = resp.headers.get('Retry-After');
    if (retryAfter) {
      respHeaders['Retry-After'] = retryAfter;
      // Access-Control-Expose-Headers muss Retry-After ENTHALTEN,
      // damit der Browser ihn im JS lesen darf!
      respHeaders['Access-Control-Expose-Headers'] =
        'Retry-After, Content-Type, Content-Length';
    }

    // Body lesen und neu bauen (wegen CORS)
    const buf = await resp.arrayBuffer();
    return new Response(buf, {
      status: resp.status,
      headers: respHeaders,
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: { message: 'Proxy error: ' + e.message } }),
      { status: 502, headers: corsHeaders() }
    );
  }
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Proxy-Secret',
    'Access-Control-Max-Age': '86400',
  };
}
