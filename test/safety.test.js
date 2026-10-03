const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const { EventEmitter } = require("node:events");

function frontend() {
  let definition;
  const timers = new Map();
  let index = 0;
  const element = () => ({
    classList: { add() {}, remove() {} }, style: { setProperty() {} },
    appendChild() {}, getBoundingClientRect() {}, querySelectorAll() { return []; },
    remove() { this.removed = true; }
  });
  vm.runInNewContext(fs.readFileSync("MMM-JumpScare.js", "utf8"), {
    Module: { register(name, value) { definition = value; } },
    Log: { info() {} }, window: { addEventListener() {} },
    document: { createElement: element, body: { appendChild() {} } }, Date, Math,
    setTimeout(fn, delay) { timers.set(++index, { fn, delay }); return index; },
    clearTimeout(id) { timers.delete(id); }
  });
  const app = Object.assign({}, definition, {
    config: structuredClone(definition.defaults), identifier: "test", sent: [],
    file(p) { return p; }, sendSocketNotification(name, payload) { this.sent.push({ name, payload }); }
  });
  app.start();
  return { app, timers };
}

function helper() {
  let definition;
  const client = new EventEmitter();
  client.subscribe = (_, __, done) => done();
  client.end = () => { client.ended = true; };
  const children = [];
  const timers = new Map();
  let index = 0;
  const context = {
    module: { exports: {} }, __dirname: process.cwd(), console,
    setTimeout(fn) { timers.set(++index, fn); return index; },
    clearTimeout(id) { timers.delete(id); },
    require(name) {
      if (name === "node_helper") return { create(value) { definition = value; return value; } };
      if (name === "mqtt") return { connect() { return client; } };
      if (name === "node:fs") return { promises: {
        realpath: async (p) => p, stat: async () => ({ isFile: () => true })
      } };
      if (name === "node:child_process") return { spawn(command, args, options) {
        assert.equal(command, "aplay"); assert.equal(options.shell, false);
        const child = new EventEmitter(); child.kill = () => { child.killed = true; };
        children.push(child); return child;
      } };
      return require(name);
    }
  };
  vm.runInNewContext(fs.readFileSync("node_helper.js", "utf8"), context);
  const app = Object.assign({}, definition, { sent: [],
    sendSocketNotification(name, payload) { this.sent.push({ name, payload }); }
  });
  app.start();
  const config = frontend().app.config;
  config.enabled = true; config.mqtt.enabled = true;
  app.socketNotificationReceived("JS_CONFIG", { id: "test", config });
  return { app, client, children, timers };
}

test("disabled startup and random startup never trigger immediately", () => {
  const { app, timers } = frontend();
  assert.equal(app.trigger("default"), false);
  assert.equal(timers.size, 0);
  app.config.enabled = true; app.config.randomEnabled = true;
  app.scheduleRandom();
  assert.equal(app.overlay, null);
  assert.ok([...timers.values()][0].delay >= 1500000);
});

test("active effect, cooldown, duration clamp and immediate stop", () => {
  const { app, timers } = frontend();
  app.config.enabled = true; app.config.enforceSchedule = false;
  assert.equal(app.trigger({ preset: "static", durationMs: 99999 }), true);
  assert.equal([...timers.values()][0].delay, 10000);
  assert.equal(app.trigger("ghost"), false);
  const overlay = app.overlay;
  app.stopEffect();
  assert.equal(overlay.removed, true); assert.equal(app.overlay, null);
  assert.equal(timers.size, 0); assert.equal(app.trigger("ghost"), false);
  assert.equal(app.sent.at(-1).name, "JS_AUDIO_STOP");
});

test("schedule boundaries, overnight window and malformed window fail closed", () => {
  const { app } = frontend();
  const at = (h, m) => new Date(2026, 9, 3, h, m);
  assert.equal(app.scheduleRemaining(at(17, 59)), 0);
  assert.ok(app.scheduleRemaining(at(18, 0)) > 0);
  assert.equal(app.scheduleRemaining(at(22, 30)), 0);
  app.config.activeFrom = "22:00"; app.config.activeUntil = "02:00";
  assert.ok(app.scheduleRemaining(at(23, 0)) > 0);
  assert.ok(app.scheduleRemaining(at(1, 0)) > 0);
  assert.equal(app.scheduleRemaining(at(2, 0)), 0);
  app.config.activeFrom = "bad";
  assert.equal(app.scheduleRemaining(at(23, 0)), 0);
});

test("fade completion removes DOM, suspension cancels timers", () => {
  const { app, timers } = frontend();
  app.config.enabled = true; app.config.enforceSchedule = false;
  app.trigger("static");
  [...timers.values()][0].fn();
  [...timers.values()].at(-1).fn();
  assert.equal(app.overlay, null);
  app.config.randomEnabled = true; app.scheduleRandom();
  app.suspend(); assert.equal(timers.size, 0);
});

test("MQTT drops retained triggers, strips paths and honors stop", () => {
  const { app, client } = helper();
  const topic = app.config.mqtt.triggerTopic;
  const data = Buffer.from('{"preset":"ghost","durationMs":1,"sound":true,"media":"/etc/passwd"}');
  client.emit("message", topic, data, { retain: true });
  assert.equal(app.sent.length, 0);
  client.emit("message", topic, data, { retain: false });
  assert.deepEqual(Object.keys(app.sent[0].payload.trigger).sort(), ["durationMs", "preset", "sound"]);
  assert.equal(app.sent[0].payload.trigger.durationMs, 500);
  assert.equal(app.parseTrigger(Buffer.from('{bad')), null);
  assert.equal(app.parseTrigger(Buffer.alloc(1025)), null);
  client.emit("message", app.config.mqtt.stopTopic, Buffer.from("stop"), {});
  assert.equal(app.sent.at(-1).name, "JS_STOP");
  app.stop(); assert.equal(client.ended, true);
});

test("audio cancellation during async file check prevents late playback", async () => {
  const { app, children } = helper();
  const pending = app.playAudio({ preset: "default", sound: true, durationMs: 500 });
  app.stopAudio(); await pending;
  assert.equal(children.length, 0);
});

test("quiet mode, process stop, missing aplay and helper shutdown", async () => {
  const { app, children, timers } = helper();
  const payload = { preset: "default", sound: true, durationMs: 500 };
  app.config.quietMode = true; await app.playAudio(payload);
  assert.equal(children.length, 0);
  app.config.quietMode = false; await app.playAudio(payload);
  assert.equal(children.length, 1);
  app.stopAudio(); assert.equal(children[0].killed, true); assert.equal(timers.size, 0);
  await app.playAudio(payload);
  children[1].emit("error", new Error("ENOENT"));
  assert.equal(app.audio, null);
  await app.playAudio(payload); app.stop();
  assert.equal(children[2].killed, true);
});

test("media paths cannot escape module or load external URLs", () => {
  const { app } = frontend();
  assert.equal(app.safeMedia("assets/images/scare.gif"), true);
  for (const path of ["../scare.gif", "https://host/scare.gif", "/scare.gif", "assets/../../scare.gif"]) {
    assert.equal(app.safeMedia(path), false);
  }
});
