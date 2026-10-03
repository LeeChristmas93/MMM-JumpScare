const NodeHelper = require("node_helper");
const mqtt = require("mqtt");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

module.exports = NodeHelper.create({
  start() { this.owner = null; this.config = {}; this.client = null; this.audio = null; this.audioGeneration = 0; },
  debug(message) { if (this.config.debug) console.log("[MMM-JumpScare] " + message); },
  socketNotificationReceived(name, payload) {
    if (!payload || typeof payload.id !== "string") return;
    if (name === "JS_CONFIG") {
      if (this.owner && this.owner !== payload.id) return;
      this.stop();
      this.owner = payload.id;
      this.config = payload.config || {};
      this.connectMqtt();
    } else if (payload.id === this.owner) {
      if (name === "JS_AUDIO_STOP") this.stopAudio();
      if (name === "JS_PLAY") this.playAudio(payload);
    }
  },
  connectMqtt() {
    const config = this.config.mqtt || {};
    if (!this.config.enabled || !config.enabled) return;
    if (typeof config.host !== "string" || !/^[a-zA-Z0-9.:-]+$/.test(config.host) ||
      !Number.isInteger(config.port) || config.port < 1 || config.port > 65535 ||
      typeof config.triggerTopic !== "string" || !config.triggerTopic || /[+#\u0000]/.test(config.triggerTopic) ||
      (config.stopTopic && (typeof config.stopTopic !== "string" || /[+#\u0000]/.test(config.stopTopic))) ||
      config.stopTopic === config.triggerTopic) {
      this.debug("Ungültige MQTT-Konfiguration."); return;
    }
    try {
      const client = mqtt.connect({ protocol: "mqtt", hostname: config.host, port: config.port,
        username: config.username || undefined, password: config.password || undefined,
        reconnectPeriod: 5000, connectTimeout: 10000, clean: true, resubscribe: false });
      this.client = client;
      client.on("error", () => this.debug("MQTT-Verbindungsfehler."));
      client.on("connect", () => {
        client.subscribe([config.triggerTopic, config.stopTopic].filter(Boolean), { qos: 0 }, (err) => {
          if (err) this.debug("MQTT-Abonnement fehlgeschlagen.");
        });
      });
      client.on("message", (topic, buffer, packet) => {
        if (this.client !== client) return;
        if (topic === config.stopTopic) {
          this.stopAudio(); this.sendSocketNotification("JS_STOP", { id: this.owner }); return;
        }
        // A retained trigger must never fire on reconnect/startup.
        if (topic !== config.triggerTopic || (packet && packet.retain)) return;
        const trigger = this.parseTrigger(buffer);
        if (trigger) this.sendSocketNotification("JS_TRIGGER", { id: this.owner, trigger });
      });
    } catch (_) { this.debug("MQTT konnte nicht gestartet werden."); }
  },
  parseTrigger(buffer) {
    if (!buffer || buffer.length > 1024) return null;
    const text = buffer.toString().trim();
    let input;
    try { input = text.startsWith("{") ? JSON.parse(text) : { preset: text }; }
    catch (_) { this.debug("Ungültige MQTT-Payload."); return null; }
    if (!input || typeof input !== "object" || Array.isArray(input)) return null;
    const result = { preset: typeof input.preset === "string" ? input.preset : "default" };
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(result.preset)) return null;
    if (typeof input.durationMs === "number" && Number.isFinite(input.durationMs)) {
      result.durationMs = Math.min(10000, Math.max(500, input.durationMs));
    }
    if (typeof input.sound === "boolean") result.sound = input.sound;
    return result;
  },
  async playAudio(payload) {
    this.stopAudio();
    const generation = this.audioGeneration;
    if (!this.config.enabled || !this.config.soundEnabled || this.config.quietMode || payload.sound !== true) return;
    if (!this.config.presets || !Object.prototype.hasOwnProperty.call(this.config.presets, payload.preset)) return;
    const relative = this.config.defaultSound;
    if (typeof relative !== "string" || path.isAbsolute(relative) || relative.includes("\\") ||
      relative.split("/").includes("..") || !/\.wav$/i.test(relative)) {
      this.debug("Ungültiger WAV-Pfad."); return;
    }
    const started = Date.now();
    const duration = typeof payload.durationMs === "number" && Number.isFinite(payload.durationMs)
      ? Math.min(10000, Math.max(500, payload.durationMs)) : 2200;
    try {
      const root = await fs.promises.realpath(__dirname);
      const file = await fs.promises.realpath(path.resolve(root, relative));
      const inside = path.relative(root, file);
      if (inside.startsWith("..") || path.isAbsolute(inside) || !(await fs.promises.stat(file)).isFile()) {
        this.debug("WAV liegt nicht im Modulordner."); return;
      }
      if (generation !== this.audioGeneration || Date.now() - started >= duration) return;
      const child = spawn("aplay", ["-q", file], { stdio: "ignore", shell: false });
      this.audio = child;
      child.on("error", () => { this.debug("aplay nicht verfügbar oder Wiedergabe fehlgeschlagen."); if (this.audio === child) this.stopAudio(); });
      child.on("exit", (code) => {
        if (code) this.debug("ALSA-Wiedergabe fehlgeschlagen.");
        if (this.audio === child) { this.audio = null; clearTimeout(this.audioTimer); }
      });
      this.audioTimer = setTimeout(() => this.stopAudio(), duration - (Date.now() - started));
    } catch (_) { this.debug("WAV-Datei nicht verfügbar."); }
  },
  stopAudio() {
    this.audioGeneration += 1;
    clearTimeout(this.audioTimer);
    if (this.audio) {
      // Direct child only, no shell or grandchild; immediate kill prevents residual sound.
      try { this.audio.kill("SIGKILL"); } catch (_) { this.debug("Soundprozess bereits beendet."); }
      this.audio = null;
    }
  },
  stop() {
    this.stopAudio();
    if (this.client) { this.client.end(true); this.client = null; }
  }
});
