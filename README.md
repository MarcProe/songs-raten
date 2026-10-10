# 🎧 Songs Raten – Spotify-Party-Spiel

Kleine Web-App für das klassische Spiel „Song anhören und Titel, Interpret, Jahr raten“ – ohne Barcodes, dafür mit Spotify.

**Live:** [https://marcproe.github.io/songs-raten/](https://marcproe.github.io/songs-raten/)

## So läuft das Spiel

1. **Anfangsmaske:** Spotify verbinden (Login), Genres per Checkboxen wählen (oder keine = *alle*), Jahresbereich von–bis, Filter und Abspielzeit einstellen.
2. **▶ Spiel starten** → ein passender Song wird per Spotify-API zufällig ausgewählt und direkt auf dem verbundenen Spotify-Gerät abbespielt.
3. Nach **X Sekunden** (einstellbar, Default 20 s) stoppt die Musik automatisch.
4. **2 Sekunden später** erscheint der Button **👀 Anzeigen** – er zeigt Titel, Interpret, Jahr (+ Link zu Spotify).
5. **⏭ Nächster Song** startet die nächste Runde, **← Anfangsmaske** geht zurück zu den Einstellungen.

## Voraussetzungen

- Spotify-Konto. **Für das Remote-Playback (Play/Pause über die API) ist Spotify Premium nötig.**
- Mindestens ein Gerät (Handy/Laptop/Spotify-Connect), auf dem die Spotify-App mit demselben Konto läuft.
- Eine **Spotify Client ID** (siehe Setup).

## Setup (einmalig)

1. Unter [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard) eine App anlegen (Name z. B. „Songs Raten“).
2. **Redirect URI** eintragen: `https://marcproe.github.io/songs-raten/`
   *(Lokal: `http://localhost:8000/index.html` – beide URIs können eingetragen sein.)*
3. **Client ID** kopieren und in das Feld der Anfangsmaske eintragen (wird im Browser gespeichert).

> Der Login läuft per **OAuth Authorization Code mit PKCE** komplett im Browser:
> Kein Backend, kein Client-Secret, keine Server-Komponente.

## Starten (lokal)

```bash
git clone https://github.com/MarcProe/songs-raten.git
cd songs-raten
python3 -m http.server 8000
```

Dann im Browser öffnen: <http://localhost:8000>

## Optionen

| Option | Bedeutung |
|---|---|
| **Genres** (Checkboxen) | 13 gängige Genres. Keine Auswahl = *alle* (pro Runde zufälliger Mix aus einem größeren Genre-Pool) |
| **Jahre von–bis** | Filter nach Erscheinungsjahr des Albums (z. B. 1990–2020) |
| **Nur Top-100** | nur Tracks mit Spotify-Popularity ≥ 80 |
| **Nur Alben** | Singles ausschließen (nur Album-Veröffentlichungen) |
| **Schwierig** | extrem beliebte Tracks ausschließen (Popularity ≤ 60) – für erfahrene Zuhörer |
| **Abspielzeit** | Sekunden bis Auto-Stopp (Default 20, Bereich 5–180) |

## Tech

Vanilla JS, kein Build-Step, keine Abhängigkeiten. Hosted via GitHub Pages.
Tokens liegen nur lokal im `localStorage` des Browsers.
