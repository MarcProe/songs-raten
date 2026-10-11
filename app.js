/* ============================================================
   Songs Raten – Spotify Party-Spiel
   Kein Backend: Spotify OAuth via Authorization Code + PKCE,
   direkt im Browser. Nur ein statischer Webserver erforderlich.
   ============================================================ */
(() => {
  'use strict';

  const APP_VERSION = '1.9.2';

  /* ---------------- DOM-Helper ---------------- */
  const $ = (s) => document.querySelector(s);

  /* ---------------- Crypto / PKCE ---------------- */
  const randomString = (len) => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const arr = new Uint8Array(len);
    crypto.getRandomValues(arr);
    return Array.from(arr, (b) => chars[b % chars.length]).join('');
  };
  const sha256 = (text) =>
    crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  const b64url = (buf) =>
    btoa(String.fromCharCode(...new Uint8Array(buf)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  /* ---------------- Konstanten ---------------- */
  const TOKEN_URL = 'https://accounts.spotify.com/api/token';
  const AUTHORIZE_URL = 'https://accounts.spotify.com/authorize';
  const SCOPES = ['streaming', 'user-read-playback-state', 'user-modify-playback-state'].join(' ');
  const AUTH_KEY = 'sg.auth';
  const PKCE_KEY = 'sg.pkce';
  const CLIENT_KEY = 'sg.clientId';

  // Optionaler CORS-Proxy (Cloudflare Worker) um den Retry-After-Header zu erhalten.
  // Leer = Direkt-Connection zu api.spotify.com (Retry-After NICHT lesbar).
  // Beispielswert: 'https://spotify-proxy.YOUR-SUBDOMAIN.workers.dev'
  let PROXY_URL = '';
  try { PROXY_URL = localStorage.getItem('sg.proxyUrl') || ''; } catch { }

  const GENRES = [
    { label: 'Pop', q: 'pop' },
    { label: 'Rock', q: 'rock' },
    { label: 'Hip-Hop / Rap', q: 'hip hop' },
    { label: 'Electronic / Dance', q: 'dance' },
    { label: 'Jazz', q: 'jazz' },
    { label: 'Blues', q: 'blues' },
    { label: 'Klassik', q: 'classical' },
    { label: 'Metal', q: 'metal' },
    { label: 'R&B / Soul', q: 'soul' },
    { label: 'Funk / Disco', q: 'funk' },
    { label: 'Reggae', q: 'reggae' },
    { label: 'Folk / Country', q: 'country' },
    { label: 'Latin', q: 'latin' },
  ];

  const ALL_GENRE_POOL = [
    'pop', 'rock', 'hip hop', 'dance', 'techno', 'house', 'disco', 'funk',
    'soul', 'rnb', 'jazz', 'blues', 'classical', 'opera', 'metal', 'punk',
    'indie', 'alternative', 'grunge', 'reggae', 'ska', 'country', 'folk',
    'americana', 'celtic', 'latin', 'reggaeton', 'salsa', 'kpop', 'afrobeats',
    'gospel', 'motown', 'trap', 'edm', 'drum and bass',
  ];

  let configClientId = '';

  /* ---------------- Authentifizierung ---------------- */
  const clientIdInput = $('#client-id');
  clientIdInput.value = localStorage.getItem(CLIENT_KEY) || '';
  const effectiveClientId = () => (clientIdInput.value || '').trim() || configClientId;
  const redirectUri = () => {
    const base = location.origin + location.pathname;
    return base.endsWith('/') ? base + 'index.html' : base;
  };

  const getAuth = () => { try { return JSON.parse(localStorage.getItem(AUTH_KEY)); } catch { return null; } };
  const saveAuth = (a) => (a ? localStorage.setItem(AUTH_KEY, JSON.stringify(a)) : localStorage.removeItem(AUTH_KEY));
  const validAccessToken = () => {
    const a = getAuth();
    return a && a.access_token && Date.now() < a.expires_at - 30000 ? a.access_token : null;
  };

  function renderAuth() {
    const a = getAuth();
    const el = $('#auth-status');
    if (a) {
      el.textContent = '✓ Angemeldet – Token gültig bis ' + new Date(a.expires_at).toLocaleTimeString('de-DE');
      el.className = 'status ok';
      $('#btn-logout').hidden = false;
    } else {
      el.textContent = 'Noch nicht angemeldet.';
      el.className = 'status';
      $('#btn-logout').hidden = true;
    }
    $('#btn-start').disabled = !a;
  }

  clientIdInput.addEventListener('change', () => {
    const v = clientIdInput.value.trim();
    if (v) localStorage.setItem(CLIENT_KEY, v);
    else localStorage.removeItem(CLIENT_KEY);
  });

  // Proxy-URL: Laden + Speichern
  const proxyInput = $('#proxy-url');
  if (proxyInput) {
    proxyInput.value = PROXY_URL;
    proxyInput.addEventListener('change', () => {
      const v = proxyInput.value.trim();
      PROXY_URL = v.replace(/\/+$/, ''); // trailing Slash entfernen
      if (v) try { localStorage.setItem('sg.proxyUrl', PROXY_URL); } catch {}
      else try { localStorage.removeItem('sg.proxyUrl'); } catch {}
    });
  }

  async function loadConfig() {
    try {
      const res = await fetch('config.json', { cache: 'no-store' });
      if (res.ok) {
        const cfg = await res.json();
        if (cfg && cfg.spotify_client_id) configClientId = cfg.spotify_client_id;
      }
    } catch { }
  }

  $('#btn-login').addEventListener('click', async () => {
    const id = effectiveClientId();
    if (!id) {
      $('#setup-error').textContent = 'Bitte Spotify Client ID eingeben (oder in config.json hinterlegen).';
      return;
    }
    try {
      const verifier = randomString(64);
      const challenge = b64url(await sha256(verifier));
      const state = randomString(16);
      localStorage.setItem(PKCE_KEY, JSON.stringify({ verifier, state }));
      const p = new URLSearchParams({
        client_id: id,
        response_type: 'code',
        redirect_uri: redirectUri(),
        scope: SCOPES,
        code_challenge_method: 'S256',
        code_challenge: challenge,
        state,
      });
      location.assign(AUTHORIZE_URL + '?' + p.toString());
    } catch (e) {
      $('#setup-error').textContent = 'Login fehlgeschlagen: ' + e.message;
    }
  });

  $('#btn-logout').addEventListener('click', () => { saveAuth(null); renderAuth(); });

  async function exchangeCode(code) {
    const pkce = JSON.parse(localStorage.getItem(PKCE_KEY) || 'null');
    if (!pkce) throw new Error('Kein laufender Login-Vorgang gefunden.');
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri(),
        client_id: effectiveClientId(),
        code_verifier: pkce.verifier,
      }),
    });
    const data = await res.json();
    if (!data.access_token) throw new Error(data.error_description || data.error || 'Token-Fehler');
    saveAuth({ ...data, expires_at: Date.now() + data.expires_in * 1000 });
    localStorage.removeItem(PKCE_KEY);
  }

  async function refreshAuth() {
    const a = getAuth();
    if (!a || !a.refresh_token) return false;
    try {
      const res = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: a.refresh_token,
          client_id: effectiveClientId(),
        }),
      });
      const data = await res.json();
      if (!data.access_token) return false;
      saveAuth({
        access_token: data.access_token,
        refresh_token: data.refresh_token || a.refresh_token,
        expires_at: Date.now() + data.expires_in * 1000,
      });
      renderAuth();
      return true;
    } catch { return false; }
  }

  /* ---------------- Rate-Limit / Quota-Schutz (Dev Mode) ----------------
     Spotify hat ZWEI getrennte Ebenen (offizielle Doku):
       • Rate limit  → rolling 30-s-Fenster → HTTP 429 (heilt nach kurzen Warten)
       • Dev-Quota   → 24-h-TAGES-BUDGET pro DEVELOPER-KONTO (nicht pro App!),
                       in Buckets, reason QUOTA_EXCEEDED. Reset ~alle 24 h.
     Zusätzlich: 403 = Token gehört zu einem Nutzer NICHT in der App-Allowlist.
     Wir lesen den echten Response-Body (reason/message) UND den Retry-After-
     Header aus und zeigen sie – statt zu raten. Bei 403/QUOTA wird nicht
     blind getry (brennt sonst nur zusätzliches Budget). */
  const THROTTLE_MS = 600;
  const MAX_RETRIES = 2;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let _lastCallAt = 0;
  async function throttle() {
    const wait = _lastCallAt + THROTTLE_MS - Date.now();
    if (wait > 0) await sleep(wait);
    _lastCallAt = Date.now();
  }

  // retryAfterSek: Wert aus dem Retry-After-Header (Sekunden), falls vorhanden.
  function spotifyError(status, reason, msg, retryAfterSek) {
    let text;
    if (status === 403) {
      text = 'Zugriff verweigert (HTTP 403). Laut Spotify: Der Token gehört zu einem Spotify-Nutzer, der NICHT in der Allowlist deiner App (Development Mode) steht – oder das aktive Abspiel-Device/Konto passt nicht zum Token. Prüfe, mit welchem Konto die Spotify-App auf dem Abspiel-Device läuft.';
    } else if (reason === 'QUOTA_EXCEEDED') {
      text = 'Spotify-Dev-Quota deines Entwickler-Kontos aufgebraucht (QUOTA_EXCEEDED). Das ist ein 24-h-Tages-Budget deines DEVELOPER-KONTS (kein 30-s-Fenster) – alle deine Dev-Apps teilen es. 30–60 s Warten helfen hier nicht.';
      if (Number.isFinite(retryAfterSek) && retryAfterSek > 0) {
        const h = Math.floor(retryAfterSek / 3600);
        const m = Math.round((retryAfterSek % 3600) / 60);
        text += ' Laut „Retry-After“: erst in ca. ' + (h ? h + ' h ' : '') + m + ' min wieder möglich.';
      } else {
        text += ' Exakte Restzeit ist aus dem Browser nicht lesbar (CORS blockiert den Retry-After-Header). In der Regel reset das Budget erst am nächsten Tag (~24 h). Bis dahin: Top 50 wird nur 1× alle 6 h geladen, Genre-Ergebnisse sind gecacht – das schont dein verbleibendes Budget.';
      }
    } else if (status === 429) {
      text = 'Spotify rate-limits gerade (HTTP 429, rolling 30-s-Fenster). Kurze Pause einlegen (30–60 s), dann erneut.';
    } else {
      text = 'Spotify-Aufruf fehlgeschlagen (HTTP ' + status + ')';
    }
    if (msg && msg !== 'Too many requests' && msg !== 'Forbidden') text += ' [' + msg + ']';
    const e = new Error(text);
    e.spotify = true;
    return e;
  }

  async function apiFetch(path, opts = {}, authRetry = true) {
    let token = validAccessToken();
    if (!token) {
      await refreshAuth();
      token = validAccessToken();
      if (!token) throw new Error('Spotify-Authentifizierung fehlt – bitte in der Anfangsmaske anmelden.');
    }

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      await throttle();
      // Proxy-URL nutzen, falls konfiguriert (liefert Retry-After durch)
      const base = PROXY_URL ? PROXY_URL + '/v1' + path : 'https://api.spotify.com/v1' + path;
      const res = await fetch(base, {
        ...opts,
        headers: { ...(opts.headers || {}), Authorization: 'Bearer ' + token },
      });

      if (res.status === 401 && authRetry) {
        await refreshAuth();
        token = validAccessToken();
        if (!token) throw new Error('Spotify-Authentifizierung fehlt – bitte in der Anfangsmaske anmelden.');
        authRetry = false;
        continue;
      }

      if (!res.ok && (res.status === 429 || res.status === 403)) {
        let reason = '', msg = '';
        try { const b = await res.json(); if (b && b.error) { reason = b.error.reason || ''; msg = b.error.message || ''; } } catch { }

        const isQuota = reason === 'QUOTA_EXCEEDED';

        // Retry-After für die Meldung auslesen (Quota sagt damit, wann's wieder geht).
        let retryAfterSek = NaN;
        const ra = res.headers.get('Retry-After');
        if (ra && /^\d+$/.test(ra)) retryAfterSek = parseInt(ra, 10);

        // 403 (Allowlist) und QUOTA_EXCEEDED heilen nicht durch sofortiges Retrying
        // → mit echtem Grund abbrechen, kein zusätzliches Budget verbrennen.
        if (res.status === 403 || isQuota) throw spotifyError(res.status, reason, msg, retryAfterSek);

        // Plain Rate Limit (429, rolling Window) → kurz zurückfahren, dann retry.
        if (attempt < MAX_RETRIES) {
          let waitMs = 0;
          if (Number.isFinite(retryAfterSek)) waitMs = retryAfterSek * 1000;
          if (waitMs <= 0) waitMs = [4000, 12000][attempt] || 12000;
          // Sehr große Wartezeit (Quota-artig) → nicht ewig blockieren, sauber abbrechen.
          if (waitMs > 15000) throw spotifyError(res.status, reason, msg, retryAfterSek);
          await sleep(waitMs);
          continue;
        }
        throw spotifyError(res.status, reason, msg, retryAfterSek);
      }

      return res;
    }
    return res;
  }

  /* ---------------- Parameter ---------------- */
  function readParams() {
    const modeEl = document.querySelector('input[name="mode"]:checked');
    return {
      mode: modeEl ? modeEl.value : 'genre',
      genres: [...document.querySelectorAll('#genres input:checked')].map((c) => c.dataset.q),
      yearFrom: parseInt($('#year-from').value, 10),
      yearTo: parseInt($('#year-to').value, 10),
      top100: $('#opt-top100').checked,
      albumsOnly: $('#opt-albums').checked,
      hard: $('#opt-hard').checked,
      legendYearFrom: parseInt($('#legend-year-from').value, 10),
      legendYearTo: parseInt($('#legend-year-to').value, 10),
      seconds: Math.min(180, Math.max(5, parseInt($('#opt-seconds').value, 10) || 20)),
      thinkSeconds: Math.min(120, Math.max(3, parseInt($('#opt-think').value, 10) || 10)),
      extendSeconds: Math.min(120, Math.max(3, parseInt($('#opt-extend').value, 10) || 10)),
    };
  }

  /* ---------------- Song-Suche ---------------- */
  const SEARCH_LIMIT_HIGH = '50';
  const SEARCH_LIMIT_LOW = '10';
  const MAX_PAGES = 5;

  /* ---------------- Spielmodi: Top 50 DE & Chart-Legenden ---------------- */
  const DE_TOP50_PLAYLIST = '37i9dQZEVXbJiZcmkrIHGU';
  let legendsCache = null;

  /* In-Session-Cache: senkt die Spotify-Requests pro Runde massiv,
     um das Development-Mode-Tages-Budget zu schonen.
       • Top 50: 1 Request alle 6 h (Charts sind wochenstabil)
       • Genre:  1 Request pro neuem Genre, danach 0 */
  const cache = { top50: null, top50At: 0, genre: {} };
  const TOP50_TTL = 6 * 3600 * 1000;

  async function loadLegends() {
    if (legendsCache) return legendsCache;
    try {
      const res = await fetch('charts.json', { cache: 'no-store' });
      if (res.ok) {
        const d = await res.json();
        legendsCache = (d && d.songs) || [];
      }
    } catch { legendsCache = []; }
    return legendsCache;
  }

  async function searchTrack(query) {
    const res = await apiFetch('/search?' + new URLSearchParams({ q: query, type: 'track', limit: '10' }));
    if (!res.ok) {
      let detail = '';
      try { const b = await res.json(); detail = b && b.error ? (b.error.message || b.error.reason) : ''; } catch { }
      throw new Error('Spotify-Suche: HTTP ' + res.status + ' (' + detail + ')');
    }
    const d = await res.json();
    return (d.tracks && d.tracks.items) || [];
  }

  async function trackToPool(t) {
    const year = t.album && t.album.release_date ? parseInt(t.album.release_date.slice(0, 4), 10) : NaN;
    const img = (t.album.images || [])[0];
    return {
      id: t.id,
      uri: t.uri,
      name: t.name,
      artists: t.artists.map((a) => a.name).join(', '),
      year: Number.isFinite(year) ? year : new Date().getFullYear(),
      image: img ? img.url : '',
      popularity: typeof t.popularity === 'number' ? t.popularity : 0,
    };
  }

  // Session-History: kein Song kommt innerhalb einer Sitzung doppelt.
  function pickFromPool(pool) {
    const valid = pool.filter(Boolean);
    if (!valid.length) return null;
    let cand = valid.filter((t) => !game.played.has(t.id));
    if (!cand.length) { game.played.clear(); cand = valid; }
    return cand[(Math.random() * cand.length) | 0];
  }

  // Top-50-Playlist: nur 1 Request alle 6 h (Cache), sonst 1 Request pro Runde.
  async function getTop50Tracks() {
    if (cache.top50 && (Date.now() - cache.top50At) < TOP50_TTL) return cache.top50;
    try {
      const s = JSON.parse(localStorage.getItem('sg.top50') || 'null');
      if (s && s.at && (Date.now() - s.at) < TOP50_TTL && Array.isArray(s.items) && s.items.length) {
        cache.top50 = s.items; cache.top50At = s.at; return s.items;
      }
    } catch { }

    const items = [];
    const res = await apiFetch('/playlists/' + DE_TOP50_PLAYLIST + '/tracks?limit=50&offset=0');
    if (res.ok) {
      const d = await res.json();
      for (const it of d.items || []) if (it && it.track) items.push(it.track);
    } else if (res.status === 400) {
      for (let off = 0; off < 50; off += 10) {
        const r2 = await apiFetch('/playlists/' + DE_TOP50_PLAYLIST + '/tracks?limit=10&offset=' + off);
        if (!r2.ok) {
          let detail = '';
          try { const b = await r2.json(); detail = b && b.error ? (b.error.message || b.error.reason) : ''; } catch { }
          throw new Error('Playlist-Abfrage: HTTP ' + r2.status + ' (' + detail + ')');
        }
        const d2 = await r2.json();
        const batch = d2.items || [];
        for (const it of batch) if (it && it.track) items.push(it.track);
        if (batch.length < 10) break;
      }
    } else {
      let detail = '';
      try { const b = await res.json(); detail = b && b.error ? (b.error.message || b.error.reason) : ''; } catch { }
      throw new Error('Playlist-Abfrage: HTTP ' + res.status + ' (' + detail + ')');
    }
    if (items.length) {
      cache.top50 = items; cache.top50At = Date.now();
      try { localStorage.setItem('sg.top50', JSON.stringify({ at: cache.top50At, items })); } catch { }
    }
    return items;
  }

  // Modus: Top 50 Deutschland
  async function findSongCharts(p, onStatus) {
    if (onStatus) onStatus(cache.top50 ? '🇩🇪 Top 50 (gecacht) – Song wird gewählt …' : '🇩🇪 Lade deutsche Top 50 …');
    const items = await getTop50Tracks();
    if (!items.length) return { _empty: 'Die Top-50-Playlist lieferte keine Songs.' };
    const pool = items.filter(Boolean).map(trackToPool);
    return pickFromPool(pool) || { _empty: 'Alle Songs der Top 50 wurden bereits gespielt – Sitzung zurückgesetzt.' };
  }

  // Modus: Chart-Legenden
  async function findSongLegends(p, onStatus) {
    if (onStatus) onStatus('Lade Chart-Legenden …');
    const all = await loadLegends();
    if (!all.length) return { _empty: 'Chart-Legenden konnten nicht geladen werden (charts.json fehlt).' };
    let cand = all.filter((s) => s.y >= p.legendYearFrom && s.y <= p.legendYearTo);
    if (!cand.length) return { _empty: 'Keine #1-Hits im Bereich ' + p.legendYearFrom + '–' + p.legendYearTo + '.' };
    cand = [...cand].sort(() => Math.random() - 0.5);
    const tried = cand.slice(0, 10);
    const norm = (x) => (x || '').toLowerCase().replace(/[^a-z0-9äöüß]/g, '');
    for (const s of tried) {
      if (onStatus) onStatus('Suche: „' + s.t + '“ …');
      try {
        const items = await searchTrack(s.t + ' ' + s.a);
        const fresh = items.filter((it) => it && !game.played.has(it.id));
        if (fresh.length) {
          let pick = fresh.find((it) => norm(it.name) === norm(s.t));
          if (!pick) pick = fresh.slice().sort((a, b) => (b.popularity || 0) - (a.popularity || 0))[0];
          const obj = await trackToPool(pick);
          obj.year = Number.isFinite(obj.year) ? obj.year : s.y;
          return obj;
        }
        if (items.length) continue; // nur schon gespielte Treffer – nächsten Kandidaten
      } catch (e) {
        if (e.spotify) throw e; // 429/403/QUOTA durchreichen (echte Meldung)
      }
    }
    return { _empty: 'Keiner der Kandidaten wurde auf Spotify gefunden (10 Versuche). Zeitraum ggf. ab ~1980 wählen.' };
  }

  async function searchGenre(genre, offset = 0) {
    const qs = new URLSearchParams({ q: 'genre:' + genre, type: 'track', limit: SEARCH_LIMIT_HIGH });
    if (offset) qs.set('offset', String(offset));
    const res = await apiFetch('/search?' + qs.toString());
    if (res.ok) {
      const data = await res.json();
      return (data.tracks && data.tracks.items) || [];
    }
    if (res.status === 400) {
      const items = [];
      const startPage = Math.floor(offset / 10);
      for (let page = startPage; page < startPage + MAX_PAGES; page++) {
        const q2 = new URLSearchParams({ q: 'genre:' + genre, type: 'track', limit: SEARCH_LIMIT_LOW, offset: String(page * 10) });
        const r2 = await apiFetch('/search?' + q2.toString());
        if (!r2.ok) {
          let detail = '';
          try { const b = await r2.json(); detail = b && b.error ? (b.error.message || b.error.reason) : ''; } catch { }
          throw new Error('Spotify /search: HTTP ' + r2.status + ' (' + detail + ')');
        }
        const d2 = await r2.json();
        const batch = (d2.tracks && d2.tracks.items) || [];
        items.push(...batch);
        if (batch.length < 10) break;
      }
      return items;
    }
    let detail = '';
    try { const b = await res.json(); detail = b && b.error ? (b.error.message || b.error.reason) : ''; } catch { }
    throw new Error('HTTP ' + res.status + ' (' + detail + ')');
  }

  // Genre-Modus: 1 Genre per Zufall → Song nur aus diesem Genre.
  // Ergebnis pro Genre wird gecacht → wiederholte Auswahl = 0 Requests.
  async function findSong(p, onStatus) {
    const genrePool = p.genres.length ? p.genres : ALL_GENRE_POOL;
    const genre = genrePool[(Math.random() * genrePool.length) | 0];
    const cacheKey = genre + (p.top100 ? ':t100' : '');

    let items = cache.genre[cacheKey];
    if (items) {
      if (onStatus) onStatus('Genre: „' + genre + '“ (gecacht) – Song wird gewählt …');
    } else {
      if (onStatus) onStatus('Genre: „' + genre + '“ – Song wird gesucht …');
      try {
        items = await searchGenre(genre);
        if (p.top100 && items.length >= 50) {
          const more = await searchGenre(genre, 50);
          if (more.length) {
            const seenIds = new Set(items.map((t) => t && t.id));
            for (const t of more) if (t && t.id && !seenIds.has(t.id)) { items.push(t); seenIds.add(t.id); }
          }
        }
        cache.genre[cacheKey] = items;
      } catch (e) {
        if (e.spotify) throw e; // 429/403/QUOTA durchreichen (echte Meldung)
        return { _empty: 'Genre-Suche fehlgeschlagen: ' + e.message };
      }
    }

    const pool = [];
    for (const t of items) {
      if (!t) continue;
      const year = t.album && t.album.release_date ? parseInt(t.album.release_date.slice(0, 4), 10) : NaN;
      if (!Number.isFinite(year) || year < p.yearFrom || year > p.yearTo) continue;
      if (p.albumsOnly && (!t.album || t.album.type !== 'ALBUM')) continue;
      if (p.hard && t.popularity > 60) continue;
      const img = (t.album.images || [])[0];
      pool.push({
        id: t.id, uri: t.uri, name: t.name,
        artists: t.artists.map((a) => a.name).join(', '),
        year, image: img ? img.url : '',
        popularity: typeof t.popularity === 'number' ? t.popularity : 0,
      });
    }
    if (!pool.length) {
      const hint = (items && items.length === 0)
        ? 'Die Suche lieferte keine Tracks – kurz warten und erneut (Rate Limit/Quota).'
        : 'Tracks in „' + genre + '“ gefunden, aber keiner im Bereich ' + p.yearFrom + '–' + p.yearTo + ' (Filter lockern oder „Nächster Song“ erneut – ggf. anderes Genre).';
      return { _empty: hint };
    }
    if (p.top100) {
      pool.sort((a, b) => b.popularity - a.popularity);
      const top = pool.slice(0, 100);
      return pickFromPool(top) || { _empty: 'Alle Top-100 aus „' + genre + '“ wurden bereits gespielt – Pool zurückgesetzt.' };
    }
    return pickFromPool(pool) || { _empty: 'Alle Songs aus „' + genre + '“ wurden bereits gespielt – Pool zurückgesetzt.' };
  }

  /* ---------------- Playback ---------------- */
  async function getDevices() {
    const res = await apiFetch('/me/player/devices');
    if (!res.ok) throw new Error('Geräteabfrage fehlgeschlagen (HTTP ' + res.status + ')');
    return (await res.json()).devices || [];
  }

  async function startPlayback(song) {
    const devices = await getDevices();
    if (!devices.length) {
      throw new Error('Kein Spotify-verbundenes Gerät gefunden. Bitte die Spotify-App auf einem Gerät mit demselben Konto öffnen.');
    }
    const device = devices.find((d) => d.is_active) || devices[0];
    const res = await apiFetch('/me/player/play?device_id=' + encodeURIComponent(device.id), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uris: [song.uri], position_in_ms: 0 }),
    });
    if (!res.ok && res.status !== 202 && res.status !== 204) {
      const data = await res.json().catch(() => ({}));
      throw new Error((data.error && data.error.message) || 'Playback fehlgeschlagen (HTTP ' + res.status + ')');
    }
    return device.id;
  }

  function pausePlayback(deviceId) {
    const path = deviceId ? '/me/player/pause?device_id=' + encodeURIComponent(deviceId) : '/me/player/pause';
    apiFetch(path, { method: 'PUT' }).catch(() => { });
  }

  /* ---------------- Web Audio: Fanfare ---------------- */
  let _audioCtx = null;
  function getAudioCtx() {
    if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (_audioCtx.state === 'suspended') _audioCtx.resume();
    return _audioCtx;
  }
  function playFanfare() {
    try {
      const ctx = getAudioCtx();
      const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 D5 G5 C6
      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.3, ctx.currentTime + i * 0.15);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + i * 0.15 + 0.4);
        osc.connect(gain).connect(ctx.destination);
        osc.start(ctx.currentTime + i * 0.15);
        osc.stop(ctx.currentTime + i * 0.15 + 0.5);
      });
    } catch { /* Audio nicht verfügbar */ }
  }

  /* ---------------- Spiel-Flow ---------------- */
  const game = {
    params: null, round: 0, song: null, device: null,
    timers: [], cdTimer: null, cdTotal: 0, cdLeft: 0, cdMode: 'play',
    played: new Set(),
  };

  function clearTimers() {
    game.timers.forEach(clearTimeout);
    game.timers = [];
    hideCountdown();
    hidePlayingControls();
    showSearching(false);
  }

  /* --- UI: Such-Animation --- */
  function showSearching(on) {
    const el = $('#search-anim');
    if (el) el.hidden = !on;
  }

  /* --- UI: Playing-Controls (SKIP + VERLÄNGERN) --- */
  function showPlayingControls() {
    $('#btn-skip').hidden = false;
    $('#btn-extend').hidden = false;
  }
  function hidePlayingControls() {
    $('#btn-skip').hidden = true;
    $('#btn-extend').hidden = true;
  }

  /* --- Countdown --- */
  const cdEl = () => $('#countdown');
  const cdNum = () => $('#countdown-num');
  const cdFill = () => $('#countdown-fill');

  function renderCountdown() {
    cdNum().textContent = game.cdLeft;
    const pct = game.cdTotal > 0 ? Math.max(0, (game.cdLeft / game.cdTotal) * 100) : 0;
    cdFill().style.width = pct + '%';
    const low = game.cdLeft <= 3;
    cdNum().classList.toggle('low', low);
    cdFill().classList.toggle('low', low);
  }

  function startCountdown(seconds, mode) {
    stopCountdown();
    game.cdMode = mode || 'play';
    game.cdTotal = seconds;
    game.cdLeft = seconds;
    const el = cdEl();
    el.hidden = false;
    el.classList.toggle('think', game.cdMode === 'think');
    renderCountdown();
    game.cdTimer = setInterval(() => {
      game.cdLeft -= 1;
      if (game.cdLeft <= 0) { game.cdLeft = 0; renderCountdown(); stopCountdown(); onCountdownEnd(); return; }
      renderCountdown();
    }, 1000);
  }

  function stopCountdown() {
    if (game.cdTimer) { clearInterval(game.cdTimer); game.cdTimer = null; }
  }

  function hideCountdown() {
    stopCountdown();
    const el = cdEl();
    if (el) { el.hidden = true; el.classList.remove('think'); }
  }

  function onCountdownEnd() {
    if (game.cdMode === 'think') onThinkEnd();
    else onStopped();
  }

  /* --- VERLÄNGERN: nur solange der Song läuft --- */
  function extendTime() {
    if (game.cdMode !== 'play' || !game.cdTimer) return;
    const ext = game.params.extendSeconds;
    game.cdTotal += ext;
    game.cdLeft += ext;
    renderCountdown();
    setGameStatus('🎧 +' + ext + 's – Song läuft weiter …', 'playing');
  }

  /* --- SKIP: Song überspringen, direkt zur nächsten Runde --- */
  function skipSong() {
    pausePlayback(game.device);
    clearTimers();
    hidePlayingControls();
    hideCountdown();
    setGameStatus('⏭ Song übersprungen – nächster kommt …');
    game.timers.push(setTimeout(nextSong, 400));
  }

  /* --- Nachdenken-Phase nach Song-Ende --- */
  function onStopped() {
    pausePlayback(game.device);
    hidePlayingControls();
    setGameStatus('🤔 Song beendet – noch kurz nachdenken …', 'stopped');
    startCountdown(game.params.thinkSeconds, 'think');
  }

  function onThinkEnd() {
    playFanfare();
    setGameStatus('🎉 Zeit abgelaufen! Raten ist eröffnet: <b>Titel, Interpret &amp; Jahr?</b>', 'stopped');
    $('#btn-reveal').hidden = false;
    $('#btn-next').disabled = false;
  }

  const setGameStatus = (html, cls = '') => {
    const el = $('#game-status');
    el.innerHTML = html;
    el.className = 'game-status ' + cls;
  };

  async function nextSong() {
    clearTimers();
    $('#game-error').textContent = '';
    $('#btn-next').disabled = true;
    $('#btn-reveal').hidden = true;
    $('#song-card').hidden = true;
    game.song = null;
    game.round += 1;
    $('#round-counter').textContent = 'Runde ' + game.round;
    showSearching(true);
    setGameStatus('🎵 Song wird gesucht …');
    try {
      const song = game.params.mode === 'charts'
        ? await findSongCharts(game.params, setGameStatus)
        : game.params.mode === 'legends'
          ? await findSongLegends(game.params, setGameStatus)
          : await findSong(game.params, setGameStatus);
      showSearching(false);
      if (!song || song._empty) {
        setGameStatus('❌ Kein passender Song gefunden.<br><span class="hint">' + (song && song._empty ? song._empty : 'Filter lockern.') + '</span>');
        $('#btn-next').disabled = false;
        return;
      }
      game.song = song;
      game.played.add(song.id);
      setGameStatus('▶ Starte Playback auf deinem Spotify-Gerät …');
      game.device = await startPlayback(song);
      showPlayingControls();
      setGameStatus('🎧 Song läuft – Guter Moment zum Raten …', 'playing');
      startCountdown(game.params.seconds, 'play'); // Ende des Countdowns = Song-Stopp (onStopped)
    } catch (e) {
      showSearching(false);
      $('#game-error').textContent = e.message;
      setGameStatus('⚠️ Fehler bei der Song-Auswahl oder beim Start des Playbacks.');
      $('#btn-next').disabled = false;
    }
  }

  function reveal() {
    const s = game.song;
    if (!s) return;
    $('#btn-reveal').hidden = true;
    $('#song-title').textContent = s.name;
    $('#song-artist').textContent = s.artists;
    $('#song-year').textContent = s.year;
    const img = $('#song-img');
    img.style.display = s.image ? '' : 'none';
    if (s.image) img.src = s.image;
    $('#song-link').href = 'https://open.spotify.com/track/' + s.id;
    $('#song-card').hidden = false;
  }

  $('#btn-start').addEventListener('click', () => {
    const p = readParams();
    const err = $('#setup-error');
    if (!getAuth()) { err.textContent = 'Bitte zuerst mit Spotify anmelden.'; return; }
    if (p.mode === 'genre') {
      if (!Number.isFinite(p.yearFrom) || !Number.isFinite(p.yearTo) || p.yearFrom > p.yearTo) {
        err.textContent = 'Jahresbereich prüfen (von ≤ bis).';
        return;
      }
    } else if (p.mode === 'legends') {
      if (!Number.isFinite(p.legendYearFrom) || !Number.isFinite(p.legendYearTo) || p.legendYearFrom > p.legendYearTo) {
        err.textContent = 'Zeitraum der Chart-Legenden prüfen (von ≤ bis).';
        return;
      }
    }
    err.textContent = '';
    game.params = p;
    game.round = 0;
    game.played.clear(); // neue Sitzung → History zurücksetzen
    $('#view-setup').hidden = true;
    $('#view-game').hidden = false;
    nextSong();
  });

  $('#btn-back').addEventListener('click', () => {
    clearTimers();
    pausePlayback(game.device);
    game.song = null;
    game.device = null;
    $('#song-card').hidden = true;
    $('#btn-reveal').hidden = true;
    $('#btn-next').disabled = true;
    hidePlayingControls();
    showSearching(false);
    hideCountdown();
    $('#view-game').hidden = true;
    $('#view-setup').hidden = false;
  });

  $('#btn-next').addEventListener('click', nextSong);
  $('#btn-reveal').addEventListener('click', reveal);
  $('#btn-skip').addEventListener('click', skipSong);
  $('#btn-extend').addEventListener('click', extendTime);

  /* ---------------- Init ---------------- */
  async function init() {
    if (location.protocol === 'file:') {
      document.body.insertAdjacentHTML('afterbegin',
        '<div style="background:#e5484d;color:#fff;padding:14px 20px;font-family:sans-serif">' +
        'Bitte nicht per file:// öffnen. Öffne stattdessen: <b>https://marcproe.github.io/songs-raten/</b> ' +
        'oder starte lokal <b>python3 -m http.server 8000</b>.</div>');
    }

    const wrap = $('#genres');
    for (const g of GENRES) {
      const lab = document.createElement('label');
      lab.className = 'genre';
      const c = document.createElement('input');
      c.type = 'checkbox';
      c.dataset.q = g.q;
      const span = document.createElement('span');
      span.textContent = g.label;
      lab.append(c, span);
      wrap.appendChild(lab);
    }

    const syncModeUI = () => {
      const m = (document.querySelector('input[name="mode"]:checked') || {}).value || 'genre';
      $('#card-filter-genre').hidden = m !== 'genre';
      $('#card-filter-legends').hidden = m !== 'legends';
      document.querySelectorAll('.mode').forEach((el) => el.classList.toggle('active', el.querySelector('input').checked));
    };
    document.querySelectorAll('input[name="mode"]').forEach((r) => r.addEventListener('change', syncModeUI));
    syncModeUI();
    loadLegends().catch(() => { });

    await loadConfig();

    const sp = new URLSearchParams(location.search);
    const code = sp.get('code');
    const errParam = sp.get('error');
    if (code || errParam) {
      history.replaceState({}, '', location.pathname);
      if (errParam) {
        const el = $('#auth-status');
        el.textContent = '✗ Login abgelehnt (' + errParam + ').';
        el.className = 'status err';
      } else {
        try { await exchangeCode(code); }
        catch (e) {
          const el = $('#auth-status');
          el.textContent = '✗ ' + e.message;
          el.className = 'status err';
        }
      }
    }
    renderAuth();

    const verEl = document.createElement('span');
    verEl.id = 'app-version';
    verEl.textContent = 'v' + APP_VERSION;
    document.querySelector('header h1').appendChild(verEl);
  }

  init();
})();
