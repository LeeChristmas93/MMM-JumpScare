/* global Module, Log */
Module.register("MMM-JumpScare", {
  defaults: {
    enabled: false, debug: false,
    enforceSchedule: true, activeFrom: "18:00", activeUntil: "22:30",
    cooldownMs: 600000, randomEnabled: false,
    randomIntervalMinMs: 1500000, randomIntervalMaxMs: 3600000,
    fadeInMs: 80, fadeOutMs: 180,
    mqtt: { enabled: false, host: "localhost", port: 1883, username: "", password: "",
      triggerTopic: "magicmirror/jumpscare/trigger", stopTopic: "magicmirror/jumpscare/stop" },
    soundEnabled: true, quietMode: false, defaultSound: "assets/audio/scare.wav",
    presets: {
      default: { media: null, durationMs: 2200, flash: true, sound: true, cssClass: "scare-default" },
      ghost: { media: null, durationMs: 3000, flash: false, sound: true, cssClass: "scare-ghost" },
      static: { media: null, durationMs: 1800, flash: true, sound: false, cssClass: "scare-static" }
    }
  },
  start() {
    this.overlay = null;
    this.lastTrigger = -Infinity;
    this.suspended = false;
    this.effectTimers = [];
    this.sendSocketNotification("JS_CONFIG", { id: this.identifier, config: this.config });
    this.unloadHandler = () => this.suspend();
    window.addEventListener("beforeunload", this.unloadHandler);
    this.scheduleRandom();
  },
  getStyles() { return ["MMM-JumpScare.css"]; },
  getDom() {
    const root = document.createElement("div");
    root.className = "jumpscare-placeholder";
    return root;
  },
  debug(message) { if (this.config.debug) Log.info("[MMM-JumpScare] " + message); },
  bounded(value, fallback, min, max) {
    return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
  },
  scheduleRemaining(now = new Date()) {
    const parse = (value) => {
      if (typeof value !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
      const [h, m] = value.split(":").map(Number);
      return h * 60 + m;
    };
    const from = parse(this.config.activeFrom), until = parse(this.config.activeUntil);
    if (from === null || until === null || from === until) return 0;
    const minute = now.getHours() * 60 + now.getMinutes();
    const inside = from < until ? minute >= from && minute < until : minute >= from || minute < until;
    if (!inside) return 0;
    const end = new Date(now);
    end.setHours(Math.floor(until / 60), until % 60, 0, 0);
    if (end <= now) end.setDate(end.getDate() + 1);
    return end - now;
  },
  notificationReceived(name, payload) {
    if (name === "JUMPSCARE_TRIGGER") this.trigger(payload);
    if (name === "JUMPSCARE_STOP") this.stopEffect();
  },
  socketNotificationReceived(name, payload) {
    if (!payload || payload.id !== this.identifier) return;
    if (name === "JS_TRIGGER") this.trigger(payload.trigger);
    if (name === "JS_STOP") this.stopEffect();
  },
  trigger(payload) {
    if (!this.config.enabled || this.suspended || this.overlay ||
      Date.now() - this.lastTrigger < this.bounded(this.config.cooldownMs, 600000, 0, 2147483647) ||
      (this.config.enforceSchedule && !this.scheduleRemaining())) {
      this.debug("Trigger ignoriert (deaktiviert, Effekt, Cooldown oder Zeitfenster).");
      return false;
    }
    if (typeof payload === "string") payload = { preset: payload };
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) payload = {};
    const name = typeof payload.preset === "string" ? payload.preset : "default";
    if (!Object.prototype.hasOwnProperty.call(this.config.presets, name)) {
      this.debug("Unbekanntes Preset ignoriert."); return false;
    }
    const preset = this.config.presets[name];
    if (!preset || typeof preset !== "object") return false;
    const duration = this.bounded(payload.durationMs,
      this.bounded(preset.durationMs, 2200, 500, 10000), 500, 10000);
    const fadeIn = this.bounded(this.config.fadeInMs, 80, 0, 1000);
    const fadeOut = this.bounded(this.config.fadeOutMs, 180, 0, 1000);
    const overlay = document.createElement("div");
    overlay.className = "jumpscare-overlay";
    if (typeof preset.cssClass === "string") {
      preset.cssClass.split(/\s+/).filter((s) => /^[a-zA-Z][\w-]*$/.test(s)).forEach((s) => overlay.classList.add(s));
    }
    if (preset.flash === true) overlay.classList.add("jumpscare-flash");
    overlay.style.setProperty("--jumpscare-fade", fadeIn + "ms");
    const fallback = document.createElement("div");
    fallback.className = "jumpscare-boo";
    fallback.textContent = "BOO!";
    overlay.appendChild(fallback);
    if (this.safeMedia(preset.media)) {
      const video = /\.(mp4|webm|ogv)$/i.test(preset.media);
      const media = document.createElement(video ? "video" : "img");
      media.className = "jumpscare-media";
      if (video) { media.muted = true; media.autoplay = true; media.playsInline = true; }
      const failed = () => {
        if (video) media.pause();
        media.remove(); fallback.hidden = false;
        this.debug("Medium nicht verfügbar; CSS-Fallback aktiv.");
      };
      media.onerror = failed;
      media[video ? "onloadeddata" : "onload"] = () => { fallback.hidden = true; };
      media.src = this.file(preset.media);
      overlay.appendChild(media);
      if (video) media.play().catch(failed);
    }
    // Body attachment avoids region stacking contexts without modifying other modules.
    document.body.appendChild(overlay);
    this.overlay = overlay;
    this.lastTrigger = Date.now();
    overlay.getBoundingClientRect();
    overlay.classList.add("jumpscare-visible");
    const sound = typeof payload.sound === "boolean" ? payload.sound : preset.sound === true;
    this.sendSocketNotification("JS_PLAY", { id: this.identifier, preset: name, sound, durationMs: duration });
    this.effectTimers.push(setTimeout(() => {
      this.sendSocketNotification("JS_AUDIO_STOP", { id: this.identifier });
      overlay.style.setProperty("--jumpscare-fade", fadeOut + "ms");
      overlay.classList.remove("jumpscare-visible");
      this.effectTimers.push(setTimeout(() => this.stopEffect(), fadeOut));
    }, duration));
    if (this.config.enforceSchedule) this.effectTimers.push(setTimeout(() => this.stopEffect(), this.scheduleRemaining()));
    this.scheduleRandom();
    return true;
  },
  safeMedia(value) {
    return typeof value === "string" && /^(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_. -]+\.(gif|png|jpe?g|webp|mp4|webm|ogv)$/i.test(value) &&
      !value.split("/").includes("..");
  },
  stopEffect() {
    this.effectTimers.forEach(clearTimeout);
    this.effectTimers = [];
    this.sendSocketNotification("JS_AUDIO_STOP", { id: this.identifier });
    if (this.overlay) {
      this.overlay.querySelectorAll("video").forEach((video) => {
        video.pause(); video.removeAttribute("src"); video.load();
      });
      this.overlay.remove(); this.overlay = null;
    }
  },
  scheduleRandom() {
    clearTimeout(this.randomTimer);
    if (!this.config.enabled || !this.config.randomEnabled || this.suspended) return;
    const min = this.bounded(this.config.randomIntervalMinMs, 1500000, 1000, 2147483647);
    const max = Math.max(min, this.bounded(this.config.randomIntervalMaxMs, 3600000, 1000, 2147483647));
    this.randomTimer = setTimeout(() => {
      if (!this.scheduleRemaining() || !this.trigger({ preset: "default" })) this.scheduleRandom();
    }, Math.floor(min + Math.random() * (max - min)));
  },
  suspend() { this.suspended = true; clearTimeout(this.randomTimer); this.stopEffect(); },
  resume() { this.suspended = false; this.scheduleRandom(); }
});
