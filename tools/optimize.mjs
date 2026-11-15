import assert from 'node:assert/strict';
import reserved from '../../ClothPhysics/tools/export/reserved.mjs';
import {minifier} from '../../ClothPhysics/tools/export/minify.mjs';

const own = /^(?:v\.sword_trail_|v\.trail_attack$)/;
const variableTokens = /'[^']*'|(?<![\w.])(?:v|variable|t|temp)\.\w+/g;
const normalize = name => name.replace(/^variable\./, 'v.').replace(/^temp\./, 't.');
const encode = value => Buffer.from(JSON.stringify(value));
function strings(value, visit) {
  if (typeof value === 'string') visit(value);
  else if (value && typeof value === 'object') Object.values(value).forEach(v => strings(v, visit));
}
function mapValues(value, transform) {
  if (typeof value === 'string') return transform(value);
  if (Array.isArray(value)) return value.map(v => mapValues(v, transform));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, mapValues(v, transform)]));
  return value;
}

// Adjacent triangles share their tapered vertices. Fit all sixteen with the
// same scalar loop body; explicit input/output cases avoid dynamic struct access.
function shareTriangleFit(programs) {
  const axes = ['x', 'y', 'z'], fields = ['rx', 'ry', 'rz', 'px', 'py', 'pz', 'sx', 'sy', 'iz'];
  const points = new Map(), inputs = [], outputs = [], fits = new Set();
  programs.forEach((program, i) => {
    const newer = i < 2 ? 'live' : 'h' + ((i >> 1) - 1), older = 'h' + (i >> 1);
    const start = program.indexOf('t.width='), select = program.indexOf('t.px='), fit = program.indexOf('t.mx=');
    assert(start > 0 && select > start && fit > select && program.endsWith('};};'));
    const taper = program.slice(start, select), middle = taper.indexOf('t.width=', 1);
    assert(middle > 0);
    for (const [slot, a, b, text] of [[newer, 'a', 'b', taper.slice(0, middle)], [older, 'c', 'd', taper.slice(middle)]]) {
      const value = text.replace(/\bt\.([abcd])([xyz])\b/g, (token, end, axis) => end === a ? `t.${slot}_a${axis}` : end === b ? `t.${slot}_b${axis}` : token);
      if (points.has(slot)) assert.equal(points.get(slot), value);
      else points.set(slot, value);
    }
    const vertices = i % 2 ? [[newer, 'b'], [older, 'b'], [older, 'a']] : [[newer, 'a'], [newer, 'b'], [older, 'a']];
    const load = vertices.map(([slot, end], j) => axes.map(axis => `t.${['p', 'q', 'r'][j]}${axis}=t.${slot}_${end}${axis};`).join('')).join('');
    const stamp = `((v.sword_trail_mesh${i}_stamp??-1)!=(v.sword_trail_frame??0))?{v.sword_trail_mesh${i}_stamp=v.sword_trail_frame;`;
    assert(program.startsWith(stamp));
    inputs.push(`t.solve_index==${i}?{${program.slice(stamp.length, start)}${load}t.solve_run=1;};};`);
    fits.add(program.slice(fit, -4).replace(new RegExp(`v\\.sword_trail_mesh${i}_(\\w+)`, 'g'), (_, field) => field === 'visible' ? 't.solve_valid' : 't.solve_' + field));
    outputs.push(`t.solve_index==${i}?{${fields.map(field => `v.sword_trail_mesh${i}_${field}=t.solve_${field};`).join('')}};`);
  });
  assert.equal(points.size, 9);
  assert.equal(fits.size, 1, 'All triangles must use the same affine solver');
  const prepare = [...points].map(([slot, taper]) => taper + ['a', 'b'].map(end => {
    const point = `t.${slot}_${end}`;
    return axes.map(axis => `t.d${axis}=${point}${axis}-v.sword_trail_root_${axis};`).join('') +
      axes.map((axis, k) => `${point}${axis}=(${axes.map((d, j) => `v.sword_trail_root${j}${k}*t.d${d}`).join('+')})/v.sword_trail_root_s${axis};`).join('');
  }).join('')).join('');
  return `((v.sword_trail_mesh0_stamp??-1)!=(v.sword_trail_frame??0))?{v.sword_trail_mesh0_stamp=v.sword_trail_frame;v.sword_trail_active&&v.sword_trail_ready?{${prepare}};t.solve_index=0;loop(16,{t.solve_run=0;${inputs.join('')}t.solve_valid=0;t.solve_run?{${[...fits][0]}};t.solve_valid?{${outputs.join('')}};t.solve_index=t.solve_index+1;});};`;
}

// CapePhysics computes in anim_time_update, then exposes cached values to bones.
// Keep the sampling controller's on_exit timing and one shared frame guard.
function shareDisplay(doc) {
  const display = doc.animations['animation.sword_trail.display'];
  const programs = new Set();
  display.bones = mapValues(display.bones, text => {
    const at = text.lastIndexOf('return ');
    assert(at > 0, 'Expected generated display calculation');
    programs.add(text.slice(0, at));
    return text.slice(at + 7, -1).replace('(v.sword_trail_active??0)&&(v.sword_trail_ready??0)', '(v.sword_trail_show??0)');
  });
  assert.equal(programs.size, 16);
  display.animation_length = 1;
  display.anim_time_update = 'v.sword_trail_show=(v.sword_trail_active??0)&&(v.sword_trail_ready??0);' + shareTriangleFit([...programs]) + 'return math.min(q.anim_time+q.delta_time,.5);';
}

// VanillaRagdoll places original pre_animation expressions in a first prepare
// animation. Preserve every expression and its order, before all other actions.
function sharePrepare(docs) {
  for (const layer of ['', 'subpacks/actions_and_stuff_1_13/']) {
    const attachables = [...docs].filter(([name]) => name.startsWith(layer + 'attachables/'));
    const prepare = attachables[0][1]['minecraft:attachable'].description.scripts.pre_animation;
    for (const [, doc] of attachables) {
      const d = doc['minecraft:attachable'].description;
      assert.deepEqual(d.scripts.pre_animation, prepare);
      delete d.scripts.pre_animation;
      d.animations.sword_trail_prepare = 'animation.sword_trail.prepare';
      d.scripts.animate.unshift('sword_trail_prepare');
    }
    docs.set(layer + 'animations/sword_prepare.animation.json', {
      format_version: '1.10.0', animations: {
        'animation.sword_trail.prepare': {loop: true, animation_length: 1,
          anim_time_update: prepare.join('') + 'return math.min(q.anim_time+q.delta_time,.5);'}
      }
    });
  }
}

function pruneRegistrations(docs, references) {
  const names = values => values.flatMap(value => typeof value === 'string' ? [value] : Object.keys(value));
  const definitions = new Map(references);
  for (const doc of docs.values()) for (const kind of ['animations', 'animation_controllers', 'render_controllers']) {
    for (const [id, value] of Object.entries(doc[kind] ?? {})) definitions.set(id, value);
  }
  for (const [name, doc] of docs) {
    if (!name.startsWith('subpacks/actions_and_stuff_1_13/attachables/')) continue;
    const d = doc['minecraft:attachable'].description;
    const used = {animations: new Set(), materials: new Set(), textures: new Set(), geometry: new Set([d.queryable_geometry])};
    const queue = names(d.scripts.animate), texts = [JSON.stringify(d.scripts)];
    while (queue.length) {
      const alias = queue.shift(); if (used.animations.has(alias)) continue;
      used.animations.add(alias);
      const id = d.animations[alias], value = definitions.get(id);
      assert(value, `Missing A&S animation dependency: ${alias}/${id}`);
      texts.push(JSON.stringify(value));
      if (id.startsWith('controller.')) for (const state of Object.values(value.states)) queue.push(...names(state.animations ?? []));
    }
    for (const id of names(d.render_controllers)) {
      assert(definitions.has(id), `Missing A&S render dependency: ${id}`);
      texts.push(JSON.stringify(definitions.get(id)));
    }
    for (const [, prefix, alias] of texts.join(' ').matchAll(/\b(Material|Texture|Geometry)\.(\w+)/gi)) {
      used[({material: 'materials', texture: 'textures', geometry: 'geometry'})[prefix.toLowerCase()]].add(alias.toLowerCase());
    }
    for (const kind of Object.keys(used)) for (const alias of Object.keys(d[kind])) {
      if (!used[kind].has(alias.toLowerCase())) delete d[kind][alias];
    }
  }
}

export function optimizeResources(input, references) {
  const docs = new Map(), output = new Map(input);
  for (const [name, data] of input) if (/\.(?:json|material)$/.test(name)) docs.set(name, JSON.parse(data));
  shareDisplay(docs.get('animations/sword_trail.animation.json'));
  sharePrepare(docs);
  pruneRegistrations(docs, references);

  // visible is written but never read; bone channels already use ??0 for all
  // outputs, and each triangle sets its scale before the first read.
  for (const [name, doc] of docs) {
    if (!name.includes('attachables/')) continue;
    const d = doc['minecraft:attachable'].description;
    const initialize = d.scripts.initialize.map(s => s
      .replace(/v\.sword_trail_mesh\d+_(?:stamp|visible|rx|ry|rz|px|py|pz|sx|sy|iz)=[^;]+;/g, '')
      // The first emitted capture initializes every endpoint before its first read.
      .replace(/v\.sword_trail_(?:live|h\d+)_[ab][xyz]=0;/g, '')).join('');
    assert(!/\breturn\b|(?<![\w.])t\./.test(initialize), 'Joining initialization requires independent ordered statements');
    d.scripts.initialize = [initialize];
  }
  for (const [name, doc] of docs) docs.set(name, mapValues(doc, text => text.replace(/v\.sword_trail_mesh\d+_visible=[01];/g, '')));

  const text = [...docs.values()].map(JSON.stringify).join('\n');
  const external = new Set(reserved);
  const reserve = text => {
    for (const token of text.match(variableTokens) ?? []) {
      const name = normalize(token).toLowerCase();
      if (name.startsWith('v.') && !own.test(name)) external.add(name);
    }
  };
  reserve(text);
  for (const doc of references.values()) strings(doc, reserve);
  // Reuse the reference pack's frequency-ranked, exact numeric minifier.
  const minify = minifier({frequencyText: text, reservedNames: [...external], externalNames: [...external]});
  const short = text => {
    if (!/\bv\.sword_trail_|\bv\.trail_attack\b/.test(text)) return text;
    return minify(text);
  };
  for (const [name, doc] of docs) docs.set(name, mapValues(doc, short));

  // Only private generated bones/aliases are shortened; source/player/A&S names
  // are kept. One map is applied to definitions, queries, parents and references.
  const names = new Map();
  for (const doc of docs.values()) for (const geo of doc['minecraft:geometry'] ?? []) {
    for (const bone of geo.bones) if (bone.name.startsWith('sword_trail_')) names.set(bone.name,
      bone.name.replace('sword_trail_strip', 's').replace(/_scale$/, 's').replace(/_mesh$/, 'm').replace('sword_trail_', 's'));
  }
  names.set('sword_trail', 'st');
  const rename = text => text.replace(/textures\/sword_trail\/ribbon|\bsword_trail(?:_\w+)?\b/g,
    token => token.startsWith('textures/') ? token : names.get(token) ?? token.replace(/^sword_trail_/, 'st_'));
  for (const [name, doc] of docs) {
    strings(doc, value => assert(value.length < 61500, `${name}: expression exceeds reference pack's 61,500 character limit`));
    const data = encode(doc);
    output.set(name, Buffer.from(rename(data.toString())));
  }
  return {files: output, variables: minify.roots, bones: names};
}
