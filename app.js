/* ============================================================
   Songs Raten – Spotify Party-Spiel
   Kein Backend: Spotify OAuth via Authorization Code + PKCE,
   direkt im Browser. Nur ein statischer Webserver erforderlich.
   ============================================================ */
(() => {
  'use strict';

  const APP_VERSION = '1.8.1';

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

  // Pool für "Alle": pro Runde wird zufällig daraus gezogen
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
    // GitHub Pages: https://<user>.github.io/songs-raten/
    // Lokal:        http://localhost:8000/index.html
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

  async function loadConfig() {
    try {
      const res = await fetch('config.json', { cache: 'no-store' });
      if (res.ok) {
        const cfg = await res.json();
        if (cfg && cfg.spotify_client_id) configClientId = cfg.spotify_client_id;
      }
    } catch { /* config.json nicht verfügbar */ }
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

  /* ---------------- Rate-Limit-Schutz (Dev Mode) ----------------
     Spotify limitiert Dev-Apps in einem Rolling 30s-Fenster. Zu viele Calls
     liefern 429; danach antwortet Spotify bei weiterem Aufruf oft mit 403
     (Quota-Erschöpfung – dokumentiertes Dev-Mode-Verhalten). Deshalb:
     (1) Throttle zwischen Calls, (2) 429/403 → Retry-After + Backoff + Retry. */
  const THROTTLE_MS = 600;   // min. Abstand zwischen zwei API-Calls
  const MAX_RETRIES = 3;     // Retries bei 429/403
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let _lastCallAt = 0;
  async function throttle() {
    const wait = _lastCallAt + THROTTLE_MS - Date.now();
    if (wait > 0) await sleep(wait);
    _lastCallAt = Date.now();
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
      const res = await fetch('https://api.spotify.com/v1' + path, {
        ...opts,
        headers: { ...(opts.headers || {}), Authorization: 'Bearer ' + token },
      });

      // Token abgelaufen → einmal Refresh + erneut
      if (res.status === 401 && authRetry) {
        await refreshAuth();
        token = validAccessToken();
        if (!token) throw new Error('Spotify-Authentifizierung fehlt – bitte in der Anfangsmaske anmelden.');
        authRetry = false;
        continue;
      }

      // Rate-Limit (429) oder Quota-Erschöpfung (403 im Dev Mode)
      if ((res.status === 429 || res.status === 403) && attempt < MAX_RETRIES) {
        let waitMs = 0;
        const ra = res.headers.get('Retry-After');
        if (ra && /^\d+$/.test(ra)) waitMs = parseInt(ra, 10) * 1000;
        if (waitMs <= 0) waitMs = [5000, 15000, 45000][attempt] || 15000; // Backoff
        if (waitMs > 30000) {
          const sec = Math.round(waitMs / 1000);
          throw new Error('Spotify rate-limits gerade (HTTP ' + res.status + '). Bitte ca. ' + sec + ' Sekunden warten, dann „Nächster Song“ erneut.');
        }
        await sleep(waitMs);
        continue;
      }

      // Rate-Limit/Quota ohne weitere Retry-Möglichkeiten: klare Meldung
      if (res.status === 429) {
        throw new Error('Spotify rate-limits gerade (HTTP 429) – Dev-Quota im 30s-Fenster erschöpft. 30–60 Sekunden warten, dann erneut.');
      }
      if (res.status === 403) {
        throw new Error('Spotify verweigert gerade Zugriff (HTTP 403) – meist Dev-Quota im 30s-Fenster erschöpft. 30–60 Sekunden warten, dann erneut.');
      }

      return res;
    }
    return res; // Sicherheitsnetz (erreicht sich praktisch nie)
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
    };
  }

  /* ---------------- Song-Suche ----------------
     Pro Genre werden Tracks über paginierte /search-Requests geholt.
     Seit Feb 2026: max 10 Treffer pro Request (Dev Mode) bzw. 50 (Extended Quota).
     Wir versuchen limit=50; bei 400 ("Invalid limit" – oft Dev-Quota-Fehler)
     fallen wir auf limit=10 + Pagination zurück.
     "Top-100" = die bis zu 100 populärsten, die ALLE Filter erfüllen.  */
  const SEARCH_LIMIT_HIGH = '50';
  const SEARCH_LIMIT_LOW = '10';
  const MAX_PAGES = 5; // max. 50 (50) oder 50 (5×10) Tracks pro Genre

  /* ---------------- Spielmodi: Top 50 DE & Chart-Legenden ---------------- */
  const DE_TOP50_PLAYLIST = '37i9dQZEVXbJiZcmkrIHGU'; // Spotify „Top 50 - Germany“
  let legendsCache = null;

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

  // Punktgenaue Titelsuche – limit=10 läuft in jedem Quota-Modus.
  async function searchTrack(query) {
    const res = await apiFetch('/search?' + new URLSearchParams({ q: query, type: 'track', limit: '10' }));
    if (!res.ok) {
      let detail = '';
      try { const b = await res.json(); detail = b && b.error ? (b.error.message || b.error.reason) : ''; } catch {}
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

  // Modus: Top 50 Deutschland (aktuelle Charts-Playlist)
  async function findSongCharts(p, onStatus) {
    if (onStatus) onStatus('Lade deutsche Top 50 …');
    const items = [];
    const res = await apiFetch('/playlists/' + DE_TOP50_PLAYLIST + '/tracks?limit=50&offset=0');
    if (res.ok) {
      const d = await res.json();
      for (const it of d.items || []) if (it && it.track) items.push(it.track);
    } else if (res.status === 400) {
      // Dev-Mode-Fallback: 10er-Seiten
      for (let off = 0; off < 50; off += 10) {
        const r2 = await apiFetch('/playlists/' + DE_TOP50_PLAYLIST + '/tracks?limit=10&offset=' + off);
        if (!r2.ok) {
          let detail = '';
          try { const b = await r2.json(); detail = b && b.error ? (b.error.message || b.error.reason) : ''; } catch {}
          throw new Error('Playlist-Abfrage: HTTP ' + r2.status + ' (' + detail + ')');
        }
        const d2 = await r2.json();
        const batch = d2.items || [];
        for (const it of batch) if (it && it.track) items.push(it.track);
        if (batch.length < 10) break;
      }
    } else {
      let detail = '';
      try { const b = await res.json(); detail = b && b.error ? (b.error.message || b.error.reason) : ''; } catch {}
      throw new Error('Playlist-Abfrage: HTTP ' + res.status + ' (' + detail + ')');
    }
    if (!items.length) return { _empty: 'Die Top-50-Playlist lieferte keine Songs.' };
    const pool = items.filter(Boolean).map(trackToPool);
    return pool[(Math.random() * pool.length) | 0];
  }

  // Modus: Chart-Legenden (kuratierte #1-Hits, per Titelsuche auf Spotify)
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
        if (items.length) {
          let pick = items.find((it) => norm(it.name) === norm(s.t));
          if (!pick) pick = items.slice().sort((a, b) => (b.popularity || 0) - (a.popularity || 0))[0];
          const obj = await trackToPool(pick);
          obj.year = Number.isFinite(obj.year) ? obj.year : s.y;
          return obj;
        }
      } catch (e) {
        // Rate-Limit/Quota (429/403) nicht verschlucken – sofort aufhören
        if (e.message && /HTTP 429|HTTP 403/.test(e.message)) throw e;
        /* Titel nicht auf Spotify – nächsten versuchen */
      }
    }
    return { _empty: 'Keiner der Kandidaten wurde auf Spotify gefunden (10 Versuche). Zeitraum ggf. ab ~1980 wählen.' };
  }

  async function searchGenre(genre, onStatus) {
    // Erstversuch: limit=50 (Extended Quota / ältere Apps)
    const qs = new URLSearchParams({ q: 'genre:' + genre, type: 'track', limit: SEARCH_LIMIT_HIGH });
    const res = await apiFetch('/search?' + qs.toString());
    if (res.ok) {
      const data = await res.json();
      return (data.tracks && data.tracks.items) || [];
    }
    // Fallback: Dev Mode → max 10 pro Request, paginieren
    if (res.status === 400) {
      const items = [];
      for (let page = 0; page < MAX_PAGES; page++) {
        const q2 = new URLSearchParams({ q: 'genre:' + genre, type: 'track', limit: SEARCH_LIMIT_LOW, offset: String(page * 10) });
        const r2 = await apiFetch('/search?' + q2.toString());
        if (!r2.ok) {
          let detail = '';
          try { const b = await r2.json(); detail = b && b.error ? (b.error.message || b.error.reason) : ''; } catch {}
          throw new Error('Spotify /search: HTTP ' + r2.status + ' (' + detail + ') – ' +
            'Sehr wahrscheinlich: Dev-App ohne Extended Quota Mode. In developer.spotify.com/dashboard → App → Settings → Extended Quota Mode aktivieren.');
        }
        const d2 = await r2.json();
        const batch = (d2.tracks && d2.tracks.items) || [];
        items.push(...batch);
        if (batch.length < 10) break; // letzte Seite
      }
      return items;
    }
    // Andere Fehler (401, 429, 5xx)
    let detail = '';
    try { const b = await res.json(); detail = b && b.error ? (b.error.message || b.error.reason) : ''; } catch {}
    throw new Error('HTTP ' + res.status + ' (' + detail + ')');
  }

  async function findSong(p, onStatus) {
    let genres = p.genres;
    if (!genres.length) {
      genres = [...ALL_GENRE_POOL].sort(() => Math.random() - 0.5).slice(0, 6);
    }
    const seen = new Set();
    const pool = [];
    const apiErrors = [];
    let rawHits = 0;
    for (const g of genres.slice(0, 12)) {
      if (onStatus) onStatus('Suche in „' + g + '“ …');
      try {
        const items = await searchGenre(g);
        rawHits += items.length;
        for (const t of items) {
          if (!t || seen.has(t.id)) continue;
          seen.add(t.id);
          const year = t.album && t.album.release_date ? parseInt(t.album.release_date.slice(0, 4), 10) : NaN;
          if (!Number.isFinite(year) || year < p.yearFrom || year > p.yearTo) continue;
          if (p.albumsOnly && (!t.album || t.album.type !== 'ALBUM')) continue;
          if (p.hard && t.popularity > 60) continue;
          const img = (t.album.images || [])[0];
          pool.push({
            id: t.id,
            uri: t.uri,
            name: t.name,
            artists: t.artists.map((a) => a.name).join(', '),
            year,
            image: img ? img.url : '',
            popularity: typeof t.popularity === 'number' ? t.popularity : 0,
          });
        }
      } catch (e) {
        // Rate-Limit/Quota (429/403): Quota ist erschöpft – Rest der Runde nicht
        // weiter aufreizen, sofort abbrechen und klare Meldung zeigen.
        if (e.message && /HTTP 429|HTTP 403/.test(e.message)) throw e;
        apiErrors.push(g + ' → ' + e.message);
      }
    }
    if (!pool.length && apiErrors.length) {
      throw new Error(apiErrors[0]); // erster Fehler reicht (meist alle gleich)
    }
    if (apiErrors.length) console.warn('Teil-Suche fehlgeschlagen:', apiErrors.join('; '));
    if (!pool.length) {
      const hint = rawHits === 0
        ? 'Die Suche lieferte keine Tracks – Token prüfen oder kurz warten (Rate Limit).'
        : rawHits + ' Tracks gefunden, aber keiner im Bereich ' + p.yearFrom + '–' + p.yearTo + ' (ggf. Filter lockern).';
      return { _empty: hint };
    }
    if (p.top100) {
      pool.sort((a, b) => b.popularity - a.popularity);
      const top = pool.slice(0, 100);
      return top[(Math.random() * top.length) | 0];
    }
    return pool[(Math.random() * pool.length) | 0];
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
    apiFetch(path, { method: 'PUT' }).catch(() => {});
  }

  /* ---------------- Spiel-Flow ---------------- */
  const game = { params: null, round: 0, song: null, device: null, timers: [], cdTimer: null, cdTotal: 0, cdLeft: 0 };
  const clearTimers = () => {
    game.timers.forEach(clearTimeout);
    game.timers = [];
    stopCountdown();
  };

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

  function startCountdown(seconds) {
    stopCountdown();
    game.cdTotal = seconds;
    game.cdLeft = seconds;
    cdEl().hidden = false;
    renderCountdown();
    game.cdTimer = setInterval(() => {
      game.cdLeft -= 1;
      if (game.cdLeft <= 0) { game.cdLeft = 0; renderCountdown(); stopCountdown(); return; }
      renderCountdown();
    }, 1000);
  }

  function stopCountdown() {
    if (game.cdTimer) { clearInterval(game.cdTimer); game.cdTimer = null; }
    if (cdEl()) cdEl().hidden = true;
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
    setGameStatus('🎵 Song wird gesucht …');
    try {
      const song = game.params.mode === 'charts'
        ? await findSongCharts(game.params, setGameStatus)
        : game.params.mode === 'legends'
          ? await findSongLegends(game.params, setGameStatus)
          : await findSong(game.params, setGameStatus);
      if (!song || song._empty) {
        setGameStatus('❌ Kein passender Song gefunden.<br><span class="hint">' + (song && song._empty ? song._empty : 'Jahresbereich, Genre oder Filter lockern.') + '</span>');
        $('#btn-next').disabled = false;
        return;
      }
      game.song = song;
      setGameStatus('▶ Starte Playback auf deinem Spotify-Gerät …');
      game.device = await startPlayback(song);
      setGameStatus('🎧 Song läuft – Guter Moment zum Raten …', 'playing');
      startCountdown(game.params.seconds);
      game.timers.push(setTimeout(onStopped, game.params.seconds * 1000));
    } catch (e) {
      $('#game-error').textContent = e.message;
      setGameStatus('⚠️ Fehler bei der Song-Auswahl oder beim Start des Playbacks. Details unten.');
      $('#btn-next').disabled = false;
    }
  }

  function onStopped() {
    stopCountdown();
    pausePlayback(game.device);
    setGameStatus('⏹ Stopp! Raten ist eröffnet: <b>Titel, Interpret &amp; Jahr?</b>', 'stopped');
    game.timers.push(setTimeout(() => {
      $('#btn-reveal').hidden = false;
      $('#btn-next').disabled = false;
    }, 2000));
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
    $('#view-game').hidden = true;
    $('#view-setup').hidden = false;
  });

  $('#btn-next').addEventListener('click', nextSong);
  $('#btn-reveal').addEventListener('click', reveal);

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

    // Spielmodus-UI: Filter-Karten je nach Modus ein-/ausblenden
    const syncModeUI = () => {
      const m = (document.querySelector('input[name="mode"]:checked') || {}).value || 'genre';
      $('#card-filter-genre').hidden = m !== 'genre';
      $('#card-filter-legends').hidden = m !== 'legends';
      document.querySelectorAll('.mode').forEach((el) => el.classList.toggle('active', el.querySelector('input').checked));
    };
    document.querySelectorAll('input[name="mode"]').forEach((r) => r.addEventListener('change', syncModeUI));
    syncModeUI();
    loadLegends().catch(() => {}); // Legenden vorladen (nicht blockierend)

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
