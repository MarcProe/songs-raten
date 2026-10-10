/* ============================================================
   Songs Raten – Spotify Party-Spiel
   Kein Backend: Spotify OAuth via Authorization Code + PKCE,
   direkt im Browser. Nur ein statischer Webserver erforderlich.
   ============================================================ */
(() => {
  'use strict';

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

  async function apiFetch(path, opts = {}, retry = true) {
    let token = validAccessToken();
    if (!token) {
      await refreshAuth();
      token = validAccessToken();
      if (!token) throw new Error('Spotify-Authentifizierung fehlt – bitte in der Anfangsmaske anmelden.');
    }
    const res = await fetch('https://api.spotify.com/v1' + path, {
      ...opts,
      headers: { ...(opts.headers || {}), Authorization: 'Bearer ' + token },
    });
    if (res.status === 401 && retry) return apiFetch(path, opts, false);
    return res;
  }

  /* ---------------- Parameter ---------------- */
  function readParams() {
    return {
      genres: [...document.querySelectorAll('#genres input:checked')].map((c) => c.dataset.q),
      yearFrom: parseInt($('#year-from').value, 10),
      yearTo: parseInt($('#year-to').value, 10),
      top100: $('#opt-top100').checked,
      albumsOnly: $('#opt-albums').checked,
      hard: $('#opt-hard').checked,
      seconds: Math.min(180, Math.max(5, parseInt($('#opt-seconds').value, 10) || 20)),
    };
  }

  /* ---------------- Song-Suche ----------------
     Pro Genre werden bis zu 50 Tracks geholt (Spotify-Maximum) und lokal
     gefiltert. "Top-100" = die bis zu 100 populärsten Tracks, die ALLE
     Filter erfüllen, aus denen dann zufällig einer gezogen wird.         */
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
      // limit: Spotify akzeptiert hier maximal 50 – mehr gibt HTTP 400 zurück.
      const res = await apiFetch('/search?' + new URLSearchParams({ q: 'genre:' + g, type: 'track', limit: '50' }));
      if (!res.ok) {
        apiErrors.push(g + ' → HTTP ' + res.status);
        continue;
      }
      const data = await res.json();
      const items = (data && data.tracks && data.tracks.items) || [];
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
    }
    if (apiErrors.length) {
      throw new Error('Spotify-API-Fehler bei der Suche: ' + apiErrors.join(', '));
    }
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
  const game = { params: null, round: 0, song: null, device: null, timers: [] };
  const clearTimers = () => { game.timers.forEach(clearTimeout); game.timers = []; };
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
      const song = await findSong(game.params, setGameStatus);
      if (!song || song._empty) {
        setGameStatus('❌ Kein passender Song gefunden.<br><span class="hint">' + (song && song._empty ? song._empty : 'Jahresbereich, Genre oder Filter lockern.') + '</span>');
        $('#btn-next').disabled = false;
        return;
      }
      game.song = song;
      setGameStatus('▶ Starte Playback auf deinem Spotify-Gerät …');
      game.device = await startPlayback(song);
      setGameStatus('🎧 Song läuft – Stopp nach <b>' + game.params.seconds + ' s</b>. Guter Moment zum Raten …', 'playing');
      game.timers.push(setTimeout(onStopped, game.params.seconds * 1000));
    } catch (e) {
      $('#game-error').textContent = e.message;
      setGameStatus('⚠️ Fehler bei der Song-Auswahl oder beim Start des Playbacks. Details unten.');
      $('#btn-next').disabled = false;
    }
  }

  function onStopped() {
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
    if (!Number.isFinite(p.yearFrom) || !Number.isFinite(p.yearTo) || p.yearFrom > p.yearTo) {
      err.textContent = 'Jahresbereich prüfen (von ≤ bis).';
      return;
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
  }

  init();
})();
