# Lokale Medien

Es werden keine Beispielbilder, Sounds oder Downloads mitgeliefert. Erstelle die
Unterordner selbst und kopiere eigene oder rechtmäßig nutzbare Dateien hinein:

- `images/scare.gif`, `images/ghost.gif`: kleine GIFs oder PNG/JPEG/WebP-Bilder.
- `audio/scare.wav`: kurzer PCM-WAV-Sound für ALSA/aplay, vorzugsweise 16-bit.
- Optional `video/scare.mp4`: kurzes, stumm abgespieltes Video; Codec-Unterstützung
  hängt von Electron ab. Auf Pi 3B sind kleine Bilder/GIFs vorzuziehen.

Konfigurationspfade sind relativ zum Modulordner, z. B.
`assets/images/scare.gif`. Keine URLs, absoluten Pfade oder `..` verwenden.
Fehlende Bilder/Videos zeigen den CSS-Fallback; fehlende WAVs bleiben stumm.
Private Medienordner werden von Git ignoriert.
