import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { ROOT, SAMPLE, SEGMENTS, LIFETIME, build, initialize, captureNodes, meshNodes, triangleFit } from './build.mjs';
import { compileJs, MATH, strict, toMolang, checkMolang, set, when, loop, flat } from '../../tools/molang.mjs';
import { parseExpression } from '../../tools/export/parse.mjs';

// Parse and execute the final saved expressions too; a source-tree-only check
// could miss errors introduced by expression compaction or serialization.
function readScript(text) {
  let at = 0;
  const until = stop => {
    const start = at; let depth = 0, quote = false;
    for (; at < text.length; at++) {
      const c = text[at]; if (c === "'") quote = !quote;
      if (quote) continue;
      if (!depth && stop(c, text[at + 1])) return text.slice(start, at);
      if (c === '(') depth++; if (c === ')') depth--;
    }
    throw Error('Unterminated expression at ' + start);
  };
  const eat = s => { assert.equal(text.slice(at, at + s.length), s); at += s.length; };
  const sequence = () => {
    const nodes = [];
    while (at < text.length && text[at] !== '}') {
      if (text.startsWith('loop(', at)) {
        at += 5; const count = until(c => c === ','); eat(',{'); const body = sequence(); eat('});'); nodes.push(loop(count, body)); continue;
      }
      if (text.startsWith('return ', at)) {
        at += 7; const value = until(c => c === ';'); eat(';'); nodes.push(set('v.test_result', value)); continue;
      }
      const expr = until((c, next) => c === ';' || c === '?' && next === '{');
      if (text[at] === '?') {
        eat('?{'); const yes = sequence(); eat('}'); let no = [];
        if (text.startsWith(':{', at)) { at += 2; no = sequence(); eat('}'); }
        eat(';'); nodes.push(when(expr, yes, no));
      } else {
        eat(';'); const m = /^([vt]\.\w+)=(?!=)([\s\S]+)$/.exec(expr); assert.ok(m, expr.slice(0, 100)); nodes.push(set(m[1], m[2]));
      }
    }
    return nodes;
  };
  const result = sequence(); assert.equal(at, text.length); return result;
}
const safeJS = n => n.kind === 'value' ? typeof n.value === 'string' ? "'" + n.value + "'" : String(n.value)
  : n.kind === 'read' ? n.path.join('.') : n.kind === 'call' ? n.path.join('.') + '(' + n.args.map(safeJS).join(',') + ')'
    : n.kind === 'unary' ? '(' + n.op + safeJS(n.value) + ')' : n.kind === 'binary' ? '(' + safeJS(n.left) + n.op + safeJS(n.right) + ')'
      : '(' + safeJS(n.test) + '?' + safeJS(n.yes) + ':' + safeJS(n.no) + ')';
const normalize = nodes => nodes.map(n => n.kind === 'set' ? { ...n, expr: safeJS(parseExpression(n.expr)) }
  : n.kind === 'if' ? { ...n, cond: safeJS(parseExpression(n.cond)), yes: normalize(n.yes), no: normalize(n.no) }
    : { ...n, count: safeJS(parseExpression(n.count)), body: normalize(n.body) });
const fromText = s => { checkMolang(s, 'sword trail'); assert.ok(s.length <= 61500); return compileJs(normalize(readScript(s))); };

console.log('Build:', build());
const read = rel => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const builtGeometries = read('models/entity/sword_trail.geo.json')['minecraft:geometry'];
const swordDefinition = read('attachables/gkx.json')['minecraft:attachable'].description;
const queryGeometry = builtGeometries.find(g => g.description.identifier === swordDefinition.geometry[swordDefinition.queryable_geometry]);
assert.ok(queryGeometry, 'Queryable geometry alias must resolve to the patched sampling geometry');
const queryBoneNames = new Set(queryGeometry.bones.map(b => b.name));
const sampleGeometryFile = JSON.parse(fs.readFileSync(path.join(SAMPLE, 'models/entity/464e95f9.json'), 'utf8'));
const originalQueryGeometry = sampleGeometryFile['minecraft:geometry'].find(g => g.description.identifier === 'geometry.oreville_ans.kglzcj');
const requiredQueryBones = [...new Set([
  ...[...toMolang(captureNodes()).matchAll(/q\.bone_orientation_trs\('([^']+)'\)/g)].map(m => m[1]),
  // A&S reads this through v.iujjoj in its original zxyjrj controller.
  'al6e8dgo',
])];
const assertQueryBones = g => {
  const names = new Set(g.bones.map(b => b.name));
  for (const name of requiredQueryBones) assert.ok(names.has(name), `${g.description.identifier}: queryable bone missing: ${name}`);
};
assertQueryBones(queryGeometry);
assert.throws(() => assertQueryBones(originalQueryGeometry), /queryable bone missing: st_blade_base/, 'Reproduce 0.0.2 missing-bone failure');
assert.throws(() => assertQueryBones(builtGeometries[0]), /queryable bone missing/, 'An extra rendered geometry does not add queryable bones');
assert.deepEqual(queryGeometry.bones.slice(0, originalQueryGeometry.bones.length), originalQueryGeometry.bones, 'Preserve A&S original query and render bones verbatim');
assert.deepEqual(queryGeometry.description, { ...originalQueryGeometry.description, identifier: queryGeometry.description.identifier });
console.log('Queryable-geometry regression: reproduced the old missing-bone error; new geometry includes both trail markers and A&S bones.');
const controllers = read('animation_controllers/sword_trail.animation_controllers.json').animation_controllers;
const init = fromText(toMolang(initialize()));
const sourceCapture = compileJs(captureNodes());
const exportedCapture = fromText(controllers['controller.animation.sword_trail.capture'].states.a.on_exit[0]);
const animations = read('animations/sword_trail.animation.json').animations;
const outputChannels = Object.entries(animations['animation.sword_trail.display'].bones).flatMap(([bone, b]) =>
  Object.entries(b).flatMap(([channel, values]) => values.map((value, axis) => ({ bone, channel, axis, run: typeof value === 'string' ? fromText(value) : null }))));

const D = Math.PI / 180, near = (a, b, epsilon = 2e-5) => assert.ok(Math.abs(a - b) <= epsilon, `${a} != ${b}`);
const vnear = (a, b, epsilon) => a.forEach((x, i) => near(x, b[i], epsilon));
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
const mul = (R, p) => R.map(row => dot(row, p));
const transpose = R => R[0].map((_, i) => R.map(row => row[i]));
function euler(x, y, z) {
  const ca = Math.cos(x * D), sa = -Math.sin(x * D), cb = Math.cos(y * D), sb = Math.sin(y * D), cc = Math.cos(z * D), sc = -Math.sin(z * D);
  return [[cc * cb, cc * sb * sa - sc * ca, cc * sb * ca + sc * sa], [sc * cb, sc * sb * sa + cc * ca, sc * sb * ca - cc * sa], [-sb, cb * sa, cb * ca]];
}
function rendered(v, i, p) {
  const f = key => v[`st_mesh${i}_${key}`];
  const local = mul(euler(0, 0, f('iz')), p); local[0] *= f('sx'); local[1] *= f('sy');
  return mul(euler(f('rx'), f('ry'), f('rz')), local).map((x, k) => x + f(['px', 'py', 'pz'][k]));
}
const fit = compileJs(triangleFit(0));
const canonical = [[0, .5, 0], [-.5, -.5, 0], [.5, -.5, 0]];
let seed = 771; const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
for (let i = 0; i < 600; i++) {
  const positions = Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => random() * 30 - 15));
  // fit() takes temporaries, so seed them in the same expression.
  const program = ['p', 'q', 'r'].flatMap((key, k) => ['x', 'y', 'z'].map((a, j) => set('t.' + key + a, positions[k][j])));
  const v = strict({}); compileJs([...program, ...triangleFit(0)])(v, {}, MATH);
  assert.equal(v.st_mesh0_visible, 1);
  canonical.forEach((p, k) => vnear(rendered(v, 0, p), positions[k], 5e-5));
}
// Exact vertical planes exercise both Euler singularities.
for (const sign of [-1, 1]) {
  const positions = [[0, 1, 0], [0, 0, -sign], [0, 0, sign]];
  const v = strict({}); compileJs([...['p', 'q', 'r'].flatMap((key, k) => ['x', 'y', 'z'].map((a, j) => set('t.' + key + a, positions[k][j]))), ...triangleFit(0)])(v, {}, MATH);
  canonical.forEach((p, k) => vnear(rendered(v, 0, p), positions[k], 5e-5));
}
console.log('Triangle fitting: 600 arbitrary triangles and both vertical singularities match their three vertices.');

function fixture(fps, firstPerson = false) {
  const s = { time: 0, dt: 1 / fps, yaw: 0, pos: [0, 0, 0], base: [0, 0, 0], tip: [0, 10, 0], failQueries: false,
    root: { t: { x: 0, y: 0, z: 0 }, r: { x: 0, y: 0, z: 0 }, s: { x: 1, y: 1, z: 1 } } };
  const q = { life_time: () => s.time, anim_time: () => s.time, delta_time: () => s.dt, body_y_rotation: () => s.yaw,
    is_riding: () => 0, head_y_rotation: () => 0, target_y_rotation: () => 0, position: i => s.pos[i],
    bone_orientation_trs: name => { assert.ok(!s.failQueries, 'Bone read outside valid world context');
      assert.ok(queryBoneNames.has(name), 'Bone is absent from the selected queryable geometry: ' + name);
      if (name === 'root') return s.root;
      assert.ok(['st_blade_base', 'st_blade_tip'].includes(name)); const p = name === 'st_blade_base' ? s.base : s.tip;
      return { t: Object.fromEntries(['x', 'y', 'z'].map((a, i) => [a, p[i]])) };
    },
  };
  const v = strict({}); init(v, q, MATH); v.st_active = 1; v.st_fp = +firstPerson;
  return { s, q, v, tick(attack = 0) { s.time += s.dt; v.st_attack = attack; exportedCapture(v, q, MATH); } };
}

const report = [];
for (const fps of [20, 30, 60, 144]) for (const fp of [false, true]) {
  const f = fixture(fps, fp), { v, s, q } = f;
  const reference = strict({}); init(reference, q, MATH); reference.st_active = 1; reference.st_fp = +fp;
  let maxTriangles = 0;
  for (let frame = 0; frame < fps * 2; frame++) {
    const time = s.time + s.dt, a = Math.max(0, time - .25) * 5;
    s.base = [Math.cos(a) * 2, 12, Math.sin(a) * 2]; s.tip = [Math.cos(a) * 13, 16 + Math.sin(a * .8), Math.sin(a) * 13];
    s.yaw = fp ? 0 : time * 35; s.pos = fp ? [0, 0, 0] : [time * .6, 0, time * .9];
    const attack = time >= .25 && time < .7 ? (time - .25) / .5 + .03 : 0;
    s.time = time; v.st_attack = attack; Object.assign(reference, v);
    sourceCapture(reference, q, MATH); exportedCapture(v, q, MATH);
    for (const [key, value] of Object.entries(reference)) assert.deepEqual(v[key], value, key);
    // Repeated render passes must not advance the sample buffer.
    const snapshot = JSON.stringify({ ...v }); exportedCapture(v, q, MATH); assert.equal(JSON.stringify({ ...v }), snapshot);
    const order = frame % 2 ? [...outputChannels].reverse() : outputChannels;
    for (const ch of order) if (ch.run) { ch.run(v, q, MATH); assert.ok(Number.isFinite(v.test_result), `${ch.bone}.${ch.channel}`); }
    maxTriangles = Math.max(maxTriangles, Array.from({ length: SEGMENTS * 2 }, (_, i) => v[`st_mesh${i}_visible`]).reduce((a, b) => a + b, 0));
    if (time > .95) for (let i = 0; i < SEGMENTS * 2; i++) assert.equal(v[`st_mesh${i}_visible`], 0, 'Expired trail must disappear');
  }
  assert.ok(maxTriangles >= 12, `${fps} FPS should produce a connected trail`);
  // Invalid context and model reload: no bone read and no live trail.
  s.failQueries = true; v.st_active = 0; f.tick(); assert.equal(v.st_ready, 0);
  v.st_active = 1; s.time = 0; f.tick(); assert.equal(v.st_ready, 0);
  report.push({ fps, view: fp ? 'first' : 'third', maxTriangles });
}
console.log('Saved Molang, frame independence, shuffled channels, idle/expiration and reload guards:', report);

// A point already emitted must stay at the same world location when the owner
// moves or turns (first person intentionally follows the view-model frame).
for (const fp of [false, true]) {
  const f = fixture(60, fp); for (let i = 0; i < 12; i++) f.tick(); f.tick(.05); f.tick(.1);
  const old = ['x', 'y', 'z'].map(a => f.v['st_live_b' + a]);
  f.s.yaw = 83; f.s.pos = [.3, .1, -.2]; f.tick(0);
  const now = ['x', 'y', 'z'].map(a => f.v['st_live_b' + a]);
  if (fp) vnear(now, old);
  else {
    const cy = Math.cos(f.s.yaw * D), sy = Math.sin(f.s.yaw * D), pixels = 16 / .9375;
    const world = [cy * now[0] + sy * now[2], now[1], sy * now[0] - cy * now[2]].map((x, k) => x / pixels + f.s.pos[k]);
    vnear(world, [old[0] / pixels, old[1] / pixels, -old[2] / pixels]);
  }
  f.v.st_fp = fp ? 0 : 1; f.tick(0); assert.ok(f.v.st_live_age >= LIFETIME, 'View switch clears history');
  f.s.pos[0] += 100; f.tick(.4); assert.equal(f.v.st_h1_age, 1, 'Teleport must not connect to stale samples');
}
console.log('View-space / world-space reprojection, perspective switch and teleport: passed.');

// Verify affine root compensation and exact shared edges across the two halves
// of every quad with a nonidentity, scaled, animated parent root.
{
  const f = fixture(60, true); for (let i = 0; i < 12; i++) f.tick();
  f.s.root = { t: { x: 4, y: 3, z: -2 }, r: { x: 31, y: -48, z: 17 }, s: { x: .7, y: 1.1, z: 1.3 } };
  f.tick(.1); f.s.base = [3, 1, 4]; f.s.tip = [5, 11, -1]; f.tick(.2);
  const v = f.v;
  for (let i = 0; i < SEGMENTS * 2; i++) compileJs(meshNodes(i))(v, f.q, MATH);
  assert.equal(v.st_mesh0_visible, 1); assert.equal(v.st_mesh1_visible, 1);
  vnear(rendered(v, 0, canonical[1]), rendered(v, 1, canonical[0]));
  vnear(rendered(v, 0, canonical[2]), rendered(v, 1, canonical[2]));
  const R = euler(31, -48, 17), p = rendered(v, 0, canonical[0]).map((x, k) => x * [.7, 1.1, 1.3][k]);
  const actorPoint = mul(R, p).map((x, k) => x + [4, 3, -2][k]);
  vnear(actorPoint, [v.st_live_ax, v.st_live_ay, v.st_live_az]);
}
console.log('Shared triangle edges and animated/scaled root compensation: passed.');

// Resolve patch references against A&S. Strip our additions from every patched
// attachable and require exact equality with the original A&S definition.
const geo = builtGeometries[0];
const localGeometryIds = new Set(builtGeometries.map(g => g.description.identifier));
const boneNames = new Set(geo.bones.map(b => b.name));
for (const b of geo.bones) if (b.parent) assert.ok(boneNames.has(b.parent));
const rc = read('render_controllers/sword_trail.render_controllers.json').render_controllers;
const readSample = rel => JSON.parse(fs.readFileSync(path.join(SAMPLE, rel), 'utf8'));
const materials = readSample('materials/entity.material').materials;
const customMaterialNames = new Set(Object.keys(materials).map(k => k.split(':')[0]));
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
const referenceMap = (folder, key) => Object.assign({}, ...walk(path.join(SAMPLE, folder)).filter(f => f.endsWith('.json')).map(f => JSON.parse(fs.readFileSync(f, 'utf8'))[key] ?? {}));
const sampleAnimations = referenceMap('animations', 'animations'), sampleControllers = referenceMap('animation_controllers', 'animation_controllers');
const sampleRenderers = referenceMap('render_controllers', 'render_controllers');
const geometryIds = new Set(walk(path.join(SAMPLE, 'models')).filter(f => f.endsWith('.json')).flatMap(f =>
  (JSON.parse(fs.readFileSync(f, 'utf8'))['minecraft:geometry'] ?? []).map(g => g.description.identifier)));
for (const f of fs.readdirSync(path.join(ROOT, 'attachables'))) {
  const patched = read('attachables/' + f), original = readSample('attachables/' + f);
  const d = patched['minecraft:attachable'].description;
  for (const id of Object.values(d.animations)) assert.ok(animations[id] || controllers[id] || sampleAnimations[id] || sampleControllers[id], id);
  for (const entry of d.render_controllers) for (const id of typeof entry === 'string' ? [entry] : Object.keys(entry)) assert.ok(rc[id] || sampleRenderers[id], id);
  for (const id of Object.values(d.materials)) assert.ok(id === 'entity_alphatest' || customMaterialNames.has(id), id);
  for (const id of Object.values(d.geometry)) assert.ok(localGeometryIds.has(id) || geometryIds.has(id), id);
  assert.equal(d.queryable_geometry, original['minecraft:attachable'].description.queryable_geometry);
  const selected = builtGeometries.find(g => g.description.identifier === d.geometry[d.queryable_geometry]);
  assert.ok(selected, f + ': select the augmented query geometry'); assertQueryBones(selected);
  for (const text of Object.values(d.textures)) assert.ok(text.startsWith('textures/items/') || text === 'textures/misc/enchanted_item_glint' || ['.png', '.tga'].some(ext => fs.existsSync(path.join(SAMPLE, text + ext))), text);
  for (const table of ['materials', 'textures', 'geometry']) delete d[table].st_ribbon;
  d.geometry[d.queryable_geometry] = original['minecraft:attachable'].description.geometry[d.queryable_geometry];
  delete d.animations.st_display; delete d.animations.st_capture;
  assert.deepEqual(d.scripts.animate.splice(-2), ['st_display', 'st_capture']);
  assert.equal(d.scripts.initialize.pop(), toMolang(initialize()));
  assert.ok(d.scripts.pre_animation.pop().startsWith('v.st_active=0;'));
  assert.equal(d.render_controllers.pop(), 'controller.render.sword_trail.ribbon');
  assert.deepEqual(patched, original, `${f}: only trail additions and an augmented query geometry reference`);
}
assert.equal(fs.readdirSync(path.join(ROOT, 'attachables')).length, 7);
assert.equal(geo.bones.filter(b => b.cubes).length, 16);
assert.ok(!fs.existsSync(path.join(ROOT, 'entity')), 'No player entity override');
assert.ok(geo.bones.every(b => !b.texture_meshes), 'Ribbon geometry must not draw a second sword');
assert.deepEqual(Object.keys(animations), ['animation.sword_trail.display'], 'Original A&S animations stay external');
assert.deepEqual(Object.keys(controllers), ['controller.animation.sword_trail.capture'], 'Do not replace A&S combo controller');
assert.ok(!fs.existsSync(path.join(ROOT, 'materials/entity.material')), 'Use A&S materials without overriding its material file');
const dependency = read('manifest.json').dependencies[0], sampleHeader = readSample('manifest.json').header;
assert.equal(dependency.uuid, sampleHeader.uuid);
assert.equal(dependency.version.join('.'), sampleHeader.version);
assert.deepEqual(read('manifest.json').header.version, [0, 0, 3]);
console.log('Seven A&S patches, queryable bone selection, original poses/controllers preserved, dependency and resource references: passed.');

// Indicative JS cost only, not a claim about Bedrock's Molang or GPU cost.
const perfFixture = fixture(60, true); for (let i = 0; i < 12; i++) perfFixture.tick();
const mesh = Array.from({ length: SEGMENTS * 2 }, (_, i) => compileJs(meshNodes(i)));
const start = performance.now();
for (let i = 0; i < 3000; i++) {
  perfFixture.s.base = [Math.sin(i / 9) * 3, 12, 0]; perfFixture.s.tip = [Math.sin(i / 9) * 12, 19, Math.cos(i / 9) * 8];
  perfFixture.tick((i % 20 + 1) / 25); for (const fn of mesh) fn(perfFixture.v, perfFixture.q, MATH);
}
console.log('Indicative JS capture + 16 triangle fits, ms/frame:', ((performance.now() - start) / 3000).toFixed(3));
