import assert from 'node:assert/strict';
import {parseExpression} from '../../ClothPhysics/tools/export/parse.mjs';
import {MATH} from '../../Simple-Trail/src/core/molanguage.js';

// Test-only interpreter for generated scalar Molang, using the reference parser.
// Read missing variables strictly except at an explicit ?? fallback.
function expression(source) {
  const emit = n => {
    if (n.kind === 'value') return JSON.stringify(n.value);
    if (n.kind === 'read') return n.path.join('.');
    if (n.kind === 'call') return n.path.join('.') + '(' + n.args.map(emit).join(',') + ')';
    if (n.kind === 'if') return `(${emit(n.test)}?${emit(n.yes)}:${emit(n.no)})`;
    if (n.kind === 'unary') return n.op === '!' ? `+(!${emit(n.value)})` : `(${n.op}${emit(n.value)})`;
    if (n.op === '??') {
      assert(n.left.kind === 'read' && n.left.path.length === 2);
      const [scope, name] = n.left.path;
      return `(${scope}.__optional(${JSON.stringify(name)})??${emit(n.right)})`;
    }
    if (n.op === '&&') return `(${emit(n.left)}?+(!!${emit(n.right)}):0)`;
    if (n.op === '||') return `(${emit(n.left)}?1:+(!!${emit(n.right)}))`;
    return `(${emit(n.left)}${n.op}${emit(n.right)})`;
  };
  return emit(parseExpression(source));
}
function script(source) {
  let at = 0, loops = 0;
  const eat = text => {assert(source.startsWith(text, at), source.slice(at, at + 80)); at += text.length;};
  const until = ends => {
    const start = at; let depth = 0, quoted = false;
    for (; at < source.length; at++) {
      const ch = source[at];
      if (ch === "'") quoted = !quoted;
      if (quoted) continue;
      if (!depth && ends.some(end => source.startsWith(end, at))) return source.slice(start, at);
      if (ch === '(') depth++;
      if (ch === ')') depth--;
    }
    throw Error('Unterminated statement: ' + source.slice(start, start + 80));
  };
  const sequence = end => {
    let code = '';
    while (at < source.length && source[at] !== end) {
      if (source.startsWith('return ', at)) {
        eat('return '); code += 'return ' + expression(until([';'])) + ';'; eat(';');
      } else if (source.startsWith('loop(', at)) {
        eat('loop('); const count = expression(until([','])), i = loops++;
        eat(',{'); const body = sequence('}'); eat('});');
        code += `for(let i${i}=0,n${i}=Math.min(1024,Math.max(0,Math.floor(${count})));i${i}<n${i};i${i}++){${body}}`;
      } else {
        const value = until(['?{', ';']);
        if (source.startsWith('?{', at)) {
          eat('?{'); const yes = sequence('}'); eat('}'); let no = '';
          if (source.startsWith(':{', at)) {eat(':{'); no = sequence('}'); eat('}');}
          eat(';'); code += `if(${expression(value)}){${yes}}else{${no}}`;
        } else {
          eat(';'); const eq = value.indexOf('='); assert(eq > 0, value);
          code += value.slice(0, eq) + '=' + expression(value.slice(eq + 1)) + ';';
        }
      }
    }
    return code;
  };
  const code = sequence(null); assert.equal(at, source.length);
  return new Function('v', 't', 'q', 'math', 'c', code);
}
const strict = data => new Proxy(data, {get(obj, key) {
  if (key === '__optional') return name => obj[name];
  assert(key in obj, `Uninitialized variable: ${String(key)}`); return obj[key];
}});
const read = (files, name) => JSON.parse(files.get(name));
const description = (files, name) => read(files, name)['minecraft:attachable'].description;
const near = (a, b, label) => assert(Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b)), `${label}: ${a} != ${b}`);

export function checkOptimization(original, optimized) {
  const {files, variables, bones} = optimized;
  const reverse = new Map([...variables].map(([a, b]) => [b, a]));
  const canonical = text => {
    const temps = new Map();
    return text.replace(/'[^']*'|\bt\.\w+|\bv\.\w+|(?<![\w.])(?:\d*\.\d+|\d+)(?:e[+-]?\d+)?/g, token => {
      if (token.startsWith('v.')) return reverse.get(token) ?? token;
      if (token.startsWith('t.')) {if (!temps.has(token)) temps.set(token, 't.' + temps.size); return temps.get(token);}
      return Number.isFinite(Number(token)) ? String(Number(token)) : token;
    }).replace(/\(((?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\)/g, '$1');
  };
  for (const layer of ['', 'subpacks/actions_and_stuff_1_13/']) {
    const before = description(original, layer + 'attachables/gkx.json');
    const after = description(files, layer + 'attachables/gkx.json');
    assert.equal(after.scripts.animate[0], 'st_prepare');
    const prepare = Object.values(read(files, layer + 'animations/sword_prepare.animation.json').animations)[0];
    assert.equal(canonical(prepare.anim_time_update.replace(/return math.min\(.*$/, '')), canonical(before.scripts.pre_animation.join('')));
    assert.equal(after.scripts.parent_setup, before.scripts.parent_setup);
    assert.deepEqual(after.scripts.animate.slice(1, -2), before.scripts.animate.slice(0, -2));
    assert.equal(after.textures.st, 'textures/sword_trail/ribbon');
  }
  // Attack keyframes, controller conditions, and default holding pose are unchanged.
  for (const name of ['subpacks/default/animations/sword_attack.animation.json', 'subpacks/default/animation_controllers/sword_attack.animation_controllers.json']) {
    assert.deepEqual(read(files, name), read(original, name));
  }
  assert.deepEqual(Object.values(read(files, 'animations/sword_hold.animation.json').animations), Object.values(read(original, 'animations/sword_hold.animation.json').animations));

  const oldDisplay = Object.values(read(original, 'animations/sword_trail.animation.json').animations)[0];
  const newDisplay = Object.values(read(files, 'animations/sword_trail.animation.json').animations)[0];
  const solve = script(newDisplay.anim_time_update);
  const channels = [];
  for (const [bone, properties] of Object.entries(oldDisplay.bones)) for (const [property, values] of Object.entries(properties)) values.forEach((value, i) => {
    const changed = newDisplay.bones[bones.get(bone)][property][i];
    if (typeof value === 'number') assert.equal(value, changed);
    else channels.push({label: bone + '.' + property + '.' + i, before: script(value), after: script('return ' + changed + ';')});
  });
  const controller = map => Object.values(read(map, 'animation_controllers/sword_trail.animation_controllers.json').animation_controllers)[0];
  const captures = [original, files].map(map => script(Object.values(controller(map).states).find(s => s.on_exit)?.on_exit.join('')));
  const oldState = {}, newState = {}, states = [strict(oldState), strict(newState)];
  for (let i = 0; i < 2; i++) script(description(i ? files : original, 'attachables/gkx.json').scripts.initialize.join(''))(states[i], strict({}), {}, MATH, {});
  const set = (name, value) => {oldState[name.slice(2)] = value; newState[variables.get(name).slice(2)] = value;};
  let time = 0, rendered = 0;
  for (let frame = 0; frame < 720; frame++) {
    const dt = [1 / 60, 1 / 30, 1 / 144, .09][Math.floor(frame / 90) % 4]; time += dt;
    const root = {t: {x: Math.sin(time) * 2, y: 12, z: 1}, r: {x: time * 20, y: 35, z: -12}, s: {x: 1.2, y: .8, z: frame > 360 ? -1 : 1}};
    const points = ['a', 'b'].map((end, i) => ({t: {x: Math.sin(time * 9) * (4 + i * 6), y: 12 + i * 11, z: Math.cos(time * 9) * (4 + i * 6)}}));
    const q = {life_time: time, delta_time: dt, anim_time: time % 10, is_riding: 0,
      position: axis => axis === 0 ? time * 2 + (frame >= 400 ? 20 : 0) : 0,
      body_y_rotation: time * 15,
      bone_orientation_trs: name => name === 'root' ? root : name === 'sword_trail_a' || name === 'sa' ? points[0] : points[1]};
    set('v.sword_trail_active', frame % 160 > 5 ? 1 : 0);
    set('v.sword_trail_fp', frame % 240 > 120 ? 1 : 0);
    set('v.sword_trail_emit', frame % 110 < 70 ? 1 : 0);
    set('v.sword_trail_attack', (frame % 110) / 110);
    for (const axis of ['x', 'y', 'z']) set('v.sword_trail_units_' + axis, frame > 500 ? .125 : .05859375);
    // Same display-before-capture order as scripts.animate; two render evaluations
    // exercise the existing per-frame stamp, then the alternating capture on_exit.
    for (let pass = 0; pass < 2; pass++) {
      solve(states[1], strict({}), q, MATH, {});
      for (const channel of channels) {
        const a = channel.before(states[0], strict({}), q, MATH, {});
        const b = channel.after(states[1], strict({}), q, MATH, {});
        near(a, b, `${frame}/${pass}/${channel.label}`); rendered++;
      }
    }
    for (let i = 0; i < 2; i++) captures[i](states[i], strict({}), q, MATH, {});
    for (const [name, value] of Object.entries(oldState)) {
      if (name.includes('_mesh')) continue;
      const changed = newState[(variables.get('v.' + name) ?? 'v.' + name).slice(2)];
      if (/^sword_trail_(?:live|h\d+)_[ab][xyz]$/.test(name) && changed === undefined) {
        assert.equal(oldState.sword_trail_ready, 0); assert.equal(value, 0); continue;
      }
      near(value, changed, 'capture/' + name);
    }
  }
  console.log(`Optimization equivalence: ${rendered} bone-channel results matched across 720 frames, repeated passes, view changes, expiry, movement, teleport and model scale; original profile animation order/expressions preserved.`);
}
