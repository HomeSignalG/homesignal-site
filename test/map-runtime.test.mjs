// Shared map runtime backbone (lib/map-runtime.js).
// Run: node --test test/map-runtime.test.mjs
import test from 'node:test';
import assert from 'node:assert';

function mkEl(tag) {
  const style = {};
  const el = {
    tagName: (tag || 'DIV').toUpperCase(),
    style,
    children: [],
    innerHTML: '',
    clientWidth: 640,
    clientHeight: 400,
    getBoundingClientRect: () => ({ top: 80, left: 0, width: 640, height: 400 }),
    appendChild(c) { this.children.push(c); },
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    removeEventListener: () => {},
    setAttribute: () => {},
    getAttribute: () => null,
    classList: { add() {}, remove() {}, toggle() {} }
  };
  return el;
}

global.window = {
  innerHeight: 900,
  HS: {},
  requestAnimationFrame: (fn) => fn(),
  getComputedStyle: () => ({ position: 'relative' }),
  addEventListener: () => {},
  removeEventListener: () => {}
};
global.ResizeObserver = class {
  observe() {}
  disconnect() {}
  unobserve() {}
};

await import('../lib/templates.js');
await import('../lib/map.js');
await import('../lib/map-runtime.js');
const HS = global.window.HS;

const items = [
  { id: 'p1', name: 'Site A', lat: 30.1, lng: -97.6, _letter: 'A' }
];

test('createMapController exposes lifecycle API', () => {
  const stage = mkEl();
  const sch = mkEl(); const gl = mkEl(); const lf = mkEl();
  const ctrl = HS.createMapController({
    stageEl: stage,
    layers: { schematic: sch, gl: gl, lf: lf },
    center: { lat: 30.1, lng: -97.6 },
    mode: 'impact',
    getItems: () => items,
    drawSchematic: (el, its) => { el._drew = its.length; }
  });
  assert.strictEqual(typeof ctrl.redraw, 'function');
  assert.strictEqual(typeof ctrl.destroy, 'function');
  assert.strictEqual(typeof ctrl.focusItem, 'function');
  assert.strictEqual(typeof ctrl.setMode, 'function');
  ctrl.redraw();
  assert.strictEqual(sch._drew, 1);
  ctrl.destroy();
  ctrl.destroy(); // idempotent
});

test('sizeStage fills viewport and accepts repeated resize without throwing', () => {
  const stage = mkEl();
  const ctrl = HS.createMapController({
    stageEl: stage,
    layers: { schematic: mkEl(), gl: mkEl(), lf: mkEl() },
    center: { lat: 30.1, lng: -97.6 },
    mode: 'impact',
    fillViewport: true,
    getItems: () => items,
    drawSchematic: () => {}
  });
  ctrl.sizeStage();
  assert.ok(parseInt(stage.style.height, 10) >= 420);
  ctrl.sizeStage();
  ctrl.sizeStage();
  ctrl.destroy();
});

test('setMode and redraw are idempotent in schematic mode', () => {
  const stage = mkEl();
  const sch = mkEl();
  let draws = 0;
  const ctrl = HS.createMapController({
    stageEl: stage,
    layers: { schematic: sch, gl: mkEl(), lf: mkEl() },
    center: { lat: 30.1, lng: -97.6 },
    mode: 'impact',
    getItems: () => items,
    drawSchematic: () => { draws++; }
  });
  ctrl.redraw();
  const n0 = draws;
  ctrl.setMode('impact');
  ctrl.redraw();
  ctrl.setMode('impact');
  ctrl.redraw();
  assert.ok(draws > n0);
  assert.strictEqual(ctrl.getMode(), 'impact');
  ctrl.destroy();
});

test('focusItem highlights selection id', () => {
  let highlighted = null;
  const ctrl = HS.createMapController({
    stageEl: mkEl(),
    layers: { schematic: mkEl(), gl: mkEl(), lf: mkEl() },
    center: { lat: 30.1, lng: -97.6 },
    mode: 'impact',
    getItems: () => items,
    onHighlight: (id) => { highlighted = id; },
    drawSchematic: () => {}
  });
  ctrl.focusItem(items[0]);
  assert.strictEqual(ctrl.getSelectedId(), 'p1');
  assert.strictEqual(highlighted, 'p1');
  ctrl.destroy();
});
