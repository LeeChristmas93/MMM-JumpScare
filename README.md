# MMM-JumpScare

Eigenständiges, standardmäßig deaktiviertes MagicMirror²-Modul für ein seltenes
Vollbild-Overlay mit lokalen Bildern/GIFs, optional stummem Video und ALSA-WAV.
Vanilla JavaScript/CSS; einzige direkte Runtime-Abhängigkeit: `mqtt`.
Zielsystem: MagicMirror² 2.29.0, Node 20.19.0, Bullseye 32-bit, Raspberry Pi 3B.

## Installation

Auf dem Raspberry Pi ausschließlich im neuen Modulordner installieren:

```sh
cd ~/MagicMirror/modules
git clone https://github.com/LeeChristmas93/MMM-JumpScare.git
cd MMM-JumpScare
npm install
```

Den untenstehenden Block in das `modules`-Array der bestehenden
`config/config.js` einfügen. `enabled: true` aktivieren und die Broker-IP
ersetzen. Das Modul verändert weder Core noch andere Module oder PM2.
Nach der manuellen Konfiguration MagicMirror über den bestehenden PM2-Workflow
neu starten. Genau eine Instanz konfigurieren.

## Verhalten und Sicherheit

- `enabled: false` verhindert Effekte, Zufallstimer und MQTT-Verbindungen.
- Dauer: 500–10.000 ms; Fade-in standardmäßig 80 ms, Fade-out 180 ms,
  optional mit `fadeInMs`/`fadeOutMs` (0–1000 ms) konfigurierbar.
  `durationMs` läuft ab Fade-in-Beginn, Fade-out kommt hinzu.
- Cooldown beginnt bei einem akzeptierten Trigger. Während Effekt einschließlich
  Fade-out oder Cooldown wird jeder weitere Trigger verworfen, ohne Warteschlange.
  Stop setzt den Cooldown nicht zurück.
- Lokales Zeitfenster: Start inklusive, Ende exklusiv. Über Mitternacht möglich,
  z. B. `22:00`–`02:00`. Gleiche/ungültige Uhrzeiten sperren das Fenster.
  Mit `enforceSchedule: true` gilt es für alle Trigger und stoppt einen laufenden
  Effekt am Fensterende. Die lokale Zeitzone des Mirror-Browsers ist maßgeblich.
- Zufallsmodus respektiert das Zeitfenster auch bei `enforceSchedule: false`.
  Er wartet zunächst ein volles Zufallsintervall; nach jedem akzeptierten Trigger
  beginnt ein neues Intervall. Außerhalb des Fensters wird nur neu geplant.
- MQTT-Trigger mit Retain-Flag werden ignoriert, damit Neustart/Reconnect keine
  alten Effekte auslöst. Trigger deshalb ohne `-r` senden. Stop darf retained sein.
- `quietMode: true` oder `soundEnabled: false` sperrt alle Sounds.
  Preset-`sound` ist der Standard; eine boolesche Payload darf ihn überschreiben.
  Alle Presets verwenden die konfigurierte `defaultSound`-WAV.
- Debug ist standardmäßig aus. Eigene Logs enthalten keine Zugangsdaten,
  Payloads, Fehlerobjekte oder Konfigurationsobjekte. Keine MQTT-Debug-Traces
  (`DEBUG=mqtt*`) im Produktivbetrieb aktivieren.
- MQTT-Nutzername/Passwort ausschließlich im untenstehenden `mqtt`-Block
  konfigurieren. LAN-MQTT nutzt Port 1883 ohne TLS.
- Overlay-CSS ist gekapselt. Das temporäre Element liegt direkt im `body`, um
  regionale Stapelkontexte zu umgehen; nach Ende/Stop wird es entfernt.
  MMM-Halloween und dessen Hintergrund werden nicht verändert.

## Trigger und Stop

Aus einem anderen MagicMirror-Modul:

```js
this.sendNotification("JUMPSCARE_TRIGGER", { preset: "default" });
this.sendNotification("JUMPSCARE_STOP");
```

MQTT-Tests (IP anpassen; Modul aktivieren und innerhalb des Zeitfensters testen):

```sh
mosquitto_pub -h 192.168.178.X -p 1883 -t magicmirror/jumpscare/trigger -m default
mosquitto_pub -h 192.168.178.X -p 1883 -t magicmirror/jumpscare/trigger -m '{"preset":"ghost","durationMs":2500,"sound":true}'
mosquitto_pub -h 192.168.178.X -p 1883 -t magicmirror/jumpscare/stop -m stop
```

Akzeptiert werden ein Presetname oder ein JSON-Objekt. Nur `preset`, numerische
`durationMs` und boolesches `sound` werden übernommen. Andere Felder, insbesondere
Dateipfade und CSS-Klassen, werden ignoriert. Unbekannte Presets werden verworfen.
Payload-Limit: 1024 Bytes. `mqtt.stopTopic: ""` deaktiviert das Stop-Topic.
Stop beendet Overlay und Sound sofort; Notification-Stop bleibt verfügbar.

Home Assistant: Aktion in einer Automation oder einem Script bei bereits
eingerichteter MQTT-Integration:

```yaml
action: mqtt.publish
data:
  topic: magicmirror/jumpscare/trigger
  payload: '{"preset":"ghost","durationMs":2500,"sound":true}'
  qos: 0
  retain: false
```

Zum Stoppen dieselbe Aktion mit Topic `magicmirror/jumpscare/stop` und Payload
`stop` verwenden. Cooldown und Zeitfenster gelten auch für Home Assistant.

## Medien und Fehlersuche

Siehe [assets/README.md](assets/README.md). Keine Medien sind enthalten.
Ohne Datei oder bei Ladefehler erscheint ein dunkelrotes/schwarzes `BOO!`.
Video wird immer stumm abgespielt; Ton ausschließlich über `aplay`, ohne
Browser-Audio. Keine Canvas-, React- oder Videobibliothek.

- **aplay fehlt:** `command -v aplay` prüfen. `aplay` stammt aus `alsa-utils`;
  bei Bedarf über die normale Systemverwaltung installieren. Das Modul führt
  keine sudo-Befehle aus und bleibt bei fehlendem Player visuell funktionsfähig.
- **Kein Ton:** `aplay -l` und `aplay assets/audio/scare.wav` als derselbe Nutzer
  wie PM2 testen. Standard-ALSA-Ausgang, Mixer, HDMI/Klinke, Dateirechte und PCM-WAV
  prüfen. `soundEnabled`, `quietMode` und Preset/Override beachten.
- **MQTT:** Broker-IP, Port, Broker-Erreichbarkeit, ACL und Topics prüfen.
  `debug: true` liefert kurze Statusfehler; Reconnect alle fünf Sekunden.
  MQTT ist erst aktiv, wenn sowohl Modul als auch MQTT aktiviert sind.
- **Kein Overlay:** `enabled`, lokales Zeitfenster, Cooldown und Preset prüfen.
  Für einen kontrollierten Test `enforceSchedule: false`, `cooldownMs: 0`,
  `randomEnabled: false` setzen; anschließend gewünschte Begrenzungen wiederherstellen.
- **GIF/Video langsam:** Auf Pi 3B kleine Dateien und kurze GIFs verwenden.
  Codec, Auflösung und Decoder bestimmen die Videoverträglichkeit.

## Entwicklung und Grenzen

```sh
npm run check
npm test
```

Die Tests simulieren MagicMirror, DOM, MQTT und den Soundprozess. Ein echter
Pi-/Electron-/ALSA-/Broker-Test muss auf dem Zielsystem erfolgen. Cooldown ist
im Arbeitsspeicher und wird beim Neustart zurückgesetzt. Kein automatischer
Trigger beim Start; neue Live-MQTT-/Notification-Trigger können danach auslösen.
Browser-Suspend/Unload und Helper-Shutdown räumen Ressourcen auf. Bei hartem
OS-Prozessabbruch können JavaScript-Shutdown-Hooks nicht ausgeführt werden.
Lichtpulse lassen sich mit Preset-`flash: false` abschalten; reduzierte Bewegung
wird respektiert.

Die Schnittstellen folgen der offiziellen
[MagicMirror-Moduldokumentation](https://docs.magicmirror.builders/module-development/core-module-file.html)
und der [Node-Helper-Dokumentation](https://docs.magicmirror.builders/module-development/node-helper.html).

## Vollständige Beispiel-Konfiguration

```js
{
  module: "MMM-JumpScare",
  position: "fullscreen_above",
  config: {
    enabled: false,
    debug: false,

    enforceSchedule: true,
    activeFrom: "18:00",
    activeUntil: "22:30",
    cooldownMs: 10 * 60 * 1000,

    randomEnabled: false,
    randomIntervalMinMs: 25 * 60 * 1000,
    randomIntervalMaxMs: 60 * 60 * 1000,

    mqtt: {
      enabled: true,
      host: "192.168.178.X",
      port: 1883,
      username: "",
      password: "",
      triggerTopic: "magicmirror/jumpscare/trigger",
      stopTopic: "magicmirror/jumpscare/stop"
    },

    soundEnabled: true,
    quietMode: false,
    defaultSound: "assets/audio/scare.wav",

    presets: {
      default: {
        media: "assets/images/scare.gif",
        durationMs: 2200,
        flash: true,
        sound: true,
        cssClass: "scare-default"
      },
      ghost: {
        media: "assets/images/ghost.gif",
        durationMs: 3000,
        flash: false,
        sound: true,
        cssClass: "scare-ghost"
      },
      static: {
        media: null,
        durationMs: 1800,
        flash: true,
        sound: false,
        cssClass: "scare-static"
      }
    }
  }
},
```
