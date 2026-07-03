import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const APP_SOURCE = readFileSync(new URL("../src/web/public/app.js", import.meta.url), "utf8");

test("dashboard app uses local sprite URLs and real box capacity", async () => {
  const { context, elements } = await loadApp();

  context.renderBuddy({ species: "eevee", iv: [], badges: [], nextEvo: {} }, "NORMAL");
  assert.equal(elements.get("buddy-sprite").src, "/sprites/eevee");

  context.renderBox({
    buddy: { species: "eevee" },
    box: ["eevee", "umbreon"],
  });
  assert.equal(elements.get("box-count").textContent, "2 / 18");
  assert.equal(elements.get("box").children[0].children[0].src, "/sprites/eevee");
  assert.equal(elements.get("box").children[1].children[0].src, "/sprites/umbreon");
  assert.doesNotMatch(APP_SOURCE, /raw\.githubusercontent\.com/);
});

test("dashboard app shows degraded weather as degraded", async () => {
  const { context, elements } = await loadApp();

  context.renderWeather({ cond: "cloud", temp: 19, lo: 14, hi: 22, precip: 30, degraded: true }, {});

  assert.match(elements.get("weather-line").textContent, /^degraded cloud/);
});

test("settings form reports half-filled quiet hours and posts empty-name reset", async () => {
  const posted = [];
  const { context, elements } = await loadApp({ posted });
  const field = (id) => context.document.getElementById(id);
  const form = field("settings-form");

  field("settings-name").value = "Buddy";
  field("quiet-start").value = "22";
  field("quiet-end").value = "";
  await form.dispatch("submit", submitEvent());
  await flush();

  assert.match(elements.get("settings-status").textContent, /both be filled/);
  assert.equal(elements.get("settings-status").classList.has("error"), true);
  assert.deepEqual(posted, []);

  field("settings-name").value = "   ";
  field("quiet-start").value = "";
  field("quiet-end").value = "";
  field("settings-volume").value = "";
  field("settings-lat").value = "";
  field("settings-lon").value = "";
  await form.dispatch("submit", submitEvent());
  await flush();

  assert.equal(posted.length, 1);
  assert.equal(posted[0].name, "");
});

async function loadApp({ posted = [] } = {}) {
  const elements = new Map();
  const document = {
    activeElement: null,
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, makeElement(id));
      return elements.get(id);
    },
    createElement(tag) {
      return makeElement("", tag);
    },
    querySelector() {
      return null;
    },
  };
  const context = {
    document,
    fetch: async (url, options = {}) => {
      if (url === "/api/settings") {
        posted.push(JSON.parse(options.body));
        return { ok: true, json: async () => ({ ok: true }) };
      }
      return { ok: true, json: async () => defaultView() };
    },
    setInterval() {},
    Date,
  };
  vm.createContext(context);
  vm.runInContext(APP_SOURCE, context);
  await flush();
  return { context, elements };
}

function makeElement(id, tag = "div") {
  const listeners = new Map();
  const classes = new Set();
  return {
    id,
    tagName: tag.toUpperCase(),
    value: "",
    textContent: "",
    className: "",
    hidden: false,
    src: "",
    alt: "",
    disabled: false,
    style: {},
    children: [],
    classList: {
      toggle(name, on) {
        if (on) classes.add(name);
        else classes.delete(name);
      },
      has(name) {
        return classes.has(name);
      },
    },
    append(...nodes) {
      this.children.push(...nodes);
    },
    appendChild(node) {
      this.children.push(node);
      return node;
    },
    addEventListener(type, callback) {
      listeners.set(type, callback);
    },
    dispatch(type, event) {
      return listeners.get(type)?.(event);
    },
    contains(element) {
      return element === this;
    },
  };
}

function defaultView() {
  return {
    usage: {},
    weather: {},
    room: {},
    buddy: { species: "eevee", iv: [], badges: [], nextEvo: {} },
    difficulty: "NORMAL",
    box: ["eevee"],
    journey: [],
    secrets: { discovered: [], total: 0 },
    settings: { name: "Buddy", volume: 70 },
  };
}

function submitEvent() {
  return { preventDefault() {} };
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}
