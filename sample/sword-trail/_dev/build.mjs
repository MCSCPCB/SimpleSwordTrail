import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { set, when, loop, flat, toMolang, num } from '../../tools/molang.mjs';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const SAMPLE = fileURLToPath(new URL('../../_sample/[英文]Actions and Stuff 1.13/', import.meta.url));
export const SEGMENTS = 8, INTERVAL = 0.025, LIFETIME = 0.2;
const AX = ['x', 'y', 'z'], ENDS = ['a', 'b'];
const slots = ['live', ...Array.from({ length: SEGMENTS }, (_, i) => 'h' + i)];
const point = (slot, end, a) => `v.st_${slot}_${end}${a}`;
const age = slot => `v.st_${slot}_age`;
const field = (i, key) => `v.st_mesh${i}_${key}`;
const vector = (prefix, values) => AX.map((a, i) => set(prefix + a, values[i]));
const length = p => `math.sqrt(${AX.map(a => `${p}${a}*${p}${a}`).join('+')})`;
const dot = (a, b) => AX.map(k => `${a}${k}*${b}${k}`).join('+');

// The A&S attachable controller alternates states and reads its own bone TRS
// in on_exit. The two additional marker bones make these reads independent of
// Euler order, sword animation curves, and the owner's arm proportions.
export function initialize() {
  return flat([
    ...['ready', 'warm', 'active', 'attack', 'previous_attack', 'fp', 'previous_fp', 'acc', 'stamp', 'frame'].map(k => set('v.st_' + k, 0)),
    set('v.st_last_time', -1), set('v.st_bone_clock', 10000),
    ...['x', 'y', 'z', 'yaw'].map(a => set('v.st_owner_' + a, 0)),
    slots.map(s => [set(age(s), 1), ENDS.map(e => AX.map(a => set(point(s, e, a), 0)))]),
    Array.from({ length: SEGMENTS * 2 }, (_, i) => [
      set(field(i, 'stamp'), -1), set(field(i, 'visible'), 0),
      ...['rx', 'ry', 'rz', 'px', 'py', 'pz', 'sx', 'sy', 'iz'].map(k => set(field(i, k), 0)),
    ]),
  ]);
}

const clear = () => [set('v.st_ready', 0), set('v.st_acc', 0), slots.map(s => set(age(s), 1))];
// Used only in the controller's actor-backed branch; UI and unbound items cannot
// evaluate actor or bone queries. Reuse the attack progress already read by
// the original A&S sword pre_animation. Never alter its combo/placement inputs.
export const preAnimation =
  "v.st_active=0;v.st_attack=0;v.st_fp=c.is_first_person;" +
  "!q.is_in_ui&&!(v.is_paperdoll??0)&&q.is_attached?{" +
  "q.is_owner_identifier_any('minecraft:player')&&c.item_slot=='main_hand'&&!v.jvsiul?{" +
  "v.st_active=1;v.st_attack=v.pumqvt;};};";

function captureFrame() {
  return [
    set('t.base', "q.bone_orientation_trs('st_blade_base')"),
    set('t.tip', "q.bone_orientation_trs('st_blade_tip')"),
    set('t.root', "q.bone_orientation_trs('root')"),
    set('t.ca', 'math.cos(t.root.r.x)'), set('t.sa', '-math.sin(t.root.r.x)'),
    set('t.cb', 'math.cos(t.root.r.y)'), set('t.sb', 'math.sin(t.root.r.y)'),
    set('t.cc', 'math.cos(t.root.r.z)'), set('t.sc', '-math.sin(t.root.r.z)'),
    ...[['t.cc*t.cb', 't.cc*t.sb*t.sa-t.sc*t.ca', 't.cc*t.sb*t.ca+t.sc*t.sa'],
      ['t.sc*t.cb', 't.sc*t.sb*t.sa+t.cc*t.ca', 't.sc*t.sb*t.ca-t.cc*t.sa'],
      ['-t.sb', 't.cb*t.sa', 't.cb*t.ca']].flatMap((row, i) => row.map((value, j) => set(`v.st_root${i}${j}`, value))),
    AX.map(a => [set('v.st_root_' + a, 't.root.t.' + a), set('v.st_root_s' + a, `math.max(math.abs(t.root.s.${a}),0.00001)`)]),
    AX.map(a => [set('t.a' + a, `t.base.t.${a}`), set('t.b' + a, `t.tip.t.${a}`)]),
    set('t.dt', 'math.clamp(q.life_time-v.st_last_time,0,0.1)'),
    vector('t.pos', AX.map((_, i) => `q.position(${i})`)),
    set('t.yaw', 'q.is_riding?q.head_y_rotation(0)-q.target_y_rotation:q.body_y_rotation'),
    set('t.reset', '!v.st_ready||v.st_previous_fp!=v.st_fp||q.life_time-v.st_last_time>0.15||q.life_time<v.st_last_time'),
    // Reset on teleports; never connect an old trail to a different location.
    set('t.displacement', AX.map(a => `(t.pos${a}-v.st_owner_${a})*(t.pos${a}-v.st_owner_${a})`).join('+')),
    when('t.displacement>4', set('t.reset', 1)),
    when('t.reset', [clear(), set('v.st_ready', 1), set('t.dt', 0)]),
    // Third person: bring earlier points into the current actor model frame.
    // Yaw and the model/world Z flip match ClothPhysics / Simple Ragdoll.
    // First person deliberately keeps a view-model trail, not world particles.
    when('!t.reset&&!v.st_fp', [
      set('t.cy', 'math.cos(t.yaw)'), set('t.sy', 'math.sin(t.yaw)'),
      set('t.cd', 'math.cos(v.st_owner_yaw-t.yaw)'), set('t.sd', 'math.sin(v.st_owner_yaw-t.yaw)'),
      AX.map(a => set('t.d' + a, `(v.st_owner_${a}-t.pos${a})*${num(16 / 0.9375)}`)),
      set('t.ox', 't.cy*t.dx+t.sy*t.dz'), set('t.oz', 't.sy*t.dx-t.cy*t.dz'),
      slots.map(s => ENDS.map(e => [
        set('t.x', point(s, e, 'x')), set('t.z', point(s, e, 'z')),
        set(point(s, e, 'x'), 't.cd*t.x+t.sd*t.z+t.ox'),
        set(point(s, e, 'y'), `${point(s, e, 'y')}+t.dy`),
        set(point(s, e, 'z'), '-t.sd*t.x+t.cd*t.z+t.oz'),
      ])),
    ]),
    slots.map(s => set(age(s), `math.min(${age(s)}+t.dt,1)`)),
    set('t.swing', 'v.st_attack>0.015&&v.st_attack<0.88'),
    set('t.start', 't.swing&&(v.st_previous_attack<=0.015||v.st_attack<v.st_previous_attack-0.25||t.reset)'),
    when('t.start', [
      slots.map(s => [set(age(s), 1), ENDS.map(e => AX.map(a => set(point(s, e, a), `t.${e}${a}`)))]),
      set(age('live'), 0), set(age('h0'), 0), set('v.st_acc', 0), set('t.dt', 0),
    ]),
    when('t.swing', [
      // Even at 30 FPS, sample at 40 Hz by interpolating the two captured poses.
      // The live front edge follows the latest capture between fixed samples.
      ENDS.map(e => AX.map(a => set(`t.previous_${e}${a}`, point('live', e, a)))),
      set('t.old_acc', 'v.st_acc'), set('t.total', 'v.st_acc+t.dt'),
      set('t.steps', `math.min(4,math.floor(t.total/${INTERVAL}))`),
      set('t.step', 0),
      loop('t.steps', [
        set('t.u', `math.clamp((${INTERVAL}-t.old_acc+t.step*${INTERVAL})/math.max(t.dt,0.000001),0,1)`),
        Array.from({ length: SEGMENTS - 1 }, (_, k) => SEGMENTS - 1 - k).map(i => [
          set(age('h' + i), age('h' + (i - 1))),
          ENDS.map(e => AX.map(a => set(point('h' + i, e, a), point('h' + (i - 1), e, a)))),
        ]),
        ENDS.map(e => AX.map(a => set(point('h0', e, a), `math.lerp(t.previous_${e}${a},t.${e}${a},t.u)`))),
        set(age('h0'), 't.dt*(1-t.u)'), set('t.step', 't.step+1'),
      ]),
      set('v.st_acc', `t.total-t.steps*${INTERVAL}`),
      ENDS.map(e => AX.map(a => set(point('live', e, a), `t.${e}${a}`))),
      set(age('live'), 0),
    ]),
    AX.map(a => set('v.st_owner_' + a, 't.pos' + a)), set('v.st_owner_yaw', 't.yaw'),
    set('v.st_previous_attack', 'v.st_attack'), set('v.st_previous_fp', 'v.st_fp'),
    set('v.st_last_time', 'q.life_time'), set('v.st_frame', 'v.st_frame+1'),
  ];
}

export function captureNodes() {
  return flat(when('v.st_active', [
    when('q.anim_time<v.st_bone_clock', [clear(), set('v.st_warm', 0)]),
    set('v.st_bone_clock', 'q.anim_time'),
    when('q.life_time!=v.st_stamp', [
      set('v.st_stamp', 'q.life_time'),
      when('v.st_warm<0.1', [
        set('v.st_warm', 'v.st_warm+math.clamp(q.delta_time,0,0.05)'), clear(),
      ], when('(v.st_attack>0.015&&v.st_attack<0.88)||(v.st_ready&&v.st_live_age<0.2)', captureFrame(), [
        clear(), set('v.st_last_time', 'q.life_time'), set('v.st_previous_attack', 'v.st_attack'),
      ])),
    ]),
  ], [clear(), set('v.st_warm', 0)]));
}

// Each ribbon quad uses TWO triangles. A&S's triangle texture clips the quad
// to a triangle, while ClothPhysics's three-bone affine fit maps its 3 vertices
// exactly. Shared vertices therefore remain joined even when the sword twists.
export function triangleFit(i) {
  return flat([
    AX.map(a => set('t.m' + a, `(t.p${a}+(t.q${a}+t.r${a})*.5)*.5`)),
    AX.map(a => set('t.h' + a, `t.r${a}-t.q${a}`)),
    AX.map(a => set('t.i' + a, `t.p${a}-(t.q${a}+t.r${a})*.5`)),
    set('t.la', length('t.h')),
    when('t.la>0.0001', [
      AX.map(a => set('t.f' + a, `t.h${a}/t.la`)),
      set('t.lb', dot('t.i', 't.f')),
      AX.map(a => set('t.i' + a, `t.i${a}-t.lb*t.f${a}`)),
      set('t.ld', length('t.i')),
      when('t.ld>0.0001', [
        AX.map(a => set('t.k' + a, `t.i${a}/t.ld`)),
        set('t.se', '(t.la+t.ld)*.5'), set('t.sf', '(t.la-t.ld)*.5'), set('t.sg', 't.lb*.5'),
        set('t.sq', 'math.sqrt(t.se*t.se+t.sg*t.sg)'), set('t.sw', 'math.sqrt(t.sf*t.sf+t.sg*t.sg)'),
        set('t.a1', 'math.atan2(t.sg,t.sf)'), set('t.a2', 'math.atan2(-t.sg,t.se)'),
        set('t.ph', '(t.a2+t.a1)*.5'), set('t.cp', 'math.cos(t.ph)'), set('t.sp', 'math.sin(t.ph)'),
        set('t.u0', 't.cp*t.fx+t.sp*t.kx'), set('t.u1', 't.cp*t.fy+t.sp*t.ky'), set('t.u2', 't.cp*t.fz+t.sp*t.kz'),
        set('t.u3', 't.cp*t.kz-t.sp*t.fz'), set('t.u4', 't.fx*t.ky-t.fy*t.kx'),
        // Stable Euler extraction at the vertical singularity.
        when('math.abs(t.u2)>0.999999', [
          set(field(i, 'rx'), '(t.u2<0?-1:1)*math.atan2(t.cp*t.kx-t.sp*t.fx,t.cp*t.ky-t.sp*t.fy)'),
          set(field(i, 'ry'), 't.u2<0?90:-90'), set(field(i, 'rz'), 0),
        ], [
          set(field(i, 'rx'), '-math.atan2(t.u3,t.u4)'),
          set(field(i, 'ry'), 'math.asin(math.clamp(-t.u2,-1,1))'),
          set(field(i, 'rz'), '-math.atan2(t.u1,t.u0)'),
        ]),
        AX.map(a => set(field(i, 'p' + a), 't.m' + a)),
        set(field(i, 'sx'), 't.sq+t.sw'), set(field(i, 'sy'), 'math.max(t.sq-t.sw,0)'),
        set(field(i, 'iz'), '(t.a1-t.a2)*.5'), set(field(i, 'visible'), 1),
      ]),
    ]),
  ]);
}

export function meshNodes(i) {
  const s = i >> 1, newer = s === 0 ? 'live' : 'h' + (s - 1), older = 'h' + s;
  return flat(when(`(${field(i, 'stamp')}??-1)!=(v.st_frame??0)`, [
    set(field(i, 'stamp'), 'v.st_frame'), set(field(i, 'visible'), 0),
    set(field(i, 'sx'), 0), set(field(i, 'sy'), 0),
    when(`v.st_active&&v.st_ready&&${age(newer)}<${LIFETIME}&&${age(older)}<${LIFETIME}`, [
      // Taper old cross-sections about their centres, so the tail vanishes
      // continuously without using separate render controllers per segment.
      ...[[newer, 'a', 'b'], [older, 'c', 'd']].map(([slot, aName, bName]) => [
        set('t.width', `math.clamp(1-${age(slot)}/${LIFETIME},0,1)`),
        set('t.width', 't.width*t.width'),
        AX.map(a => [
          set('t.mid', `(${point(slot, 'a', a)}+${point(slot, 'b', a)})*.5`),
          set('t.half', `(${point(slot, 'b', a)}-${point(slot, 'a', a)})*.5*t.width`),
          set(`t.${aName}${a}`, 't.mid-t.half'), set(`t.${bName}${a}`, 't.mid+t.half'),
        ]),
      ]),
      ...['p', 'q', 'r'].map((dest, k) => AX.map(a => set('t.' + dest + a, 't.' + (i % 2 ? ['b', 'd', 'c'] : ['a', 'b', 'c'])[k] + a))),
      // Query positions include the parent's animated root. Undo it once,
      // because these geometry bones inherit that root again at render time.
      ...['p', 'q', 'r'].map(dest => [
        AX.map(a => set('t.d' + a, `t.${dest}${a}-v.st_root_${a}`)),
        AX.map((a, k) => set('t.' + dest + a, `(${AX.map((d, j) => `v.st_root${j}${k}*t.d${d}`).join('+')})/v.st_root_s${a}`)),
      ]),
      triangleFit(i),
    ]),
  ]));
}

export function animatedBones() {
  const bones = {};
  for (let i = 0; i < SEGMENTS * 2; i++) {
    const prefix = toMolang(meshNodes(i));
    const value = (key, fallback = 0) => `${prefix}return (v.st_active??0)&&(v.st_ready??0)?(${field(i, key)}??${fallback}):${fallback};`;
    bones['st_strip' + i] = { position: AX.map(a => value('p' + a)), rotation: ['rx', 'ry', 'rz'].map(k => value(k)) };
    bones['st_strip' + i + '_scale'] = { scale: [value('sx'), value('sy'), 1] };
    bones['st_strip' + i + '_mesh'] = { rotation: [0, 0, value('iz')] };
  }
  return bones;
}

const read = rel => JSON.parse(fs.readFileSync(path.join(SAMPLE, rel), 'utf8'));
const write = (rel, json) => {
  const out = path.join(ROOT, rel); fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(json, null, 2) + '\n');
};

export function build() {
  const sampleGeometries = read('models/entity/464e95f9.json')['minecraft:geometry'];
  const source = sampleGeometries.find(g => g.description.identifier === 'geometry.oreville_ans.mqnsmu');
  const geometry = structuredClone(source);
  geometry.description.identifier = 'geometry.sword_trail.ribbon';
  geometry.description.visible_bounds_width = 6; geometry.description.visible_bounds_height = 5;
  geometry.description.visible_bounds_offset = [0, 1, 0];
  // Only a skeleton for sampling and our ribbon. A&S's original render
  // controllers still draw the sword, including its model and glint options.
  geometry.bones = geometry.bones.filter(b => b.name !== 'al6e8dgo');
  for (const bone of geometry.bones) { delete bone.texture_meshes; delete bone.cubes; }
  const markers = [
    { name: 'st_blade_base', parent: 'sword', pivot: [0, 9, 0] },
    { name: 'st_blade_tip', parent: 'sword', pivot: [0, 20.5, 0] },
  ];
  // bone_orientation_trs reads ONLY description.queryable_geometry. A&S selects
  // its glint geometry (znbejo), not the additional ribbon render geometry.
  // Preserve every original bone/mesh there, including al6e8dgo, and add just
  // the two invisible markers. Switching queries to the ribbon would instead
  // break A&S's own al6e8dgo reads.
  const querySource = sampleGeometries.find(g => g.description.identifier === 'geometry.oreville_ans.kglzcj');
  const queryGeometry = structuredClone(querySource);
  queryGeometry.description.identifier = 'geometry.sword_trail.query';
  queryGeometry.bones.push(...markers);
  for (let i = 0; i < SEGMENTS * 2; i++) {
    const n = 'st_strip' + i;
    geometry.bones.push({ name: n, parent: 'root', pivot: [0, 0, 0] },
      { name: n + '_scale', parent: n, pivot: [0, 0, 0] },
      { name: n + '_mesh', parent: n + '_scale', pivot: [0, 0, 0], cubes: [{
        origin: [-.5, -.5, 0], size: [1, 1, 0],
        uv: { north: { uv: [0, 0], uv_size: [16, 16] } },
      }] });
  }
  write('models/entity/sword_trail.geo.json', { format_version: '1.21.0', 'minecraft:geometry': [geometry, queryGeometry] });

  const animationMap = {
    'animation.sword_trail.display': { loop: true, bones: animatedBones() },
  };
  write('animations/sword_trail.animation.json', { format_version: '1.10.0', animations: animationMap });
  const capture = toMolang(captureNodes());
  write('animation_controllers/sword_trail.animation_controllers.json', { format_version: '1.10.0', animation_controllers: {
    'controller.animation.sword_trail.capture': { initial_state: 'a', states: Object.fromEntries(['a', 'b'].map((s, i) => [s, {
      transitions: [{ [i ? 'a' : 'b']: '1' }], on_exit: [capture],
    }])) },
  } });

  const trailVisible = [{ '*': false }, ...Array.from({ length: SEGMENTS * 2 }, (_, i) => ({ ['st_strip' + i + '_mesh']: '(v.st_active??0)&&(v.st_ready??0)' }))];
  write('render_controllers/sword_trail.render_controllers.json', { format_version: '1.8.0', render_controllers: {
    'controller.render.sword_trail.ribbon': { geometry: 'Geometry.st_ribbon', rebuild_animation_matrices: true,
      materials: [{ '*': 'Material.st_ribbon' }], textures: ['Texture.st_ribbon'], part_visibility: trailVisible,
      color: { r: .72, g: .88, b: 1, a: .38 }, ignore_lighting: true,
    },
  } });

  const swords = [];
  for (const f of fs.readdirSync(path.join(SAMPLE, 'attachables'))) {
    const original = read('attachables/' + f);
    const d = original['minecraft:attachable']?.description;
    if (!d || !/^minecraft:.*_sword$/.test(d.identifier)) continue;
    const name = d.identifier.split(':')[1]; swords.push(name);
    // Append-only patch: preserve the exact A&S format version, parent setup,
    // player animation inputs, native/glint renderers, and all existing aliases.
    d.materials.st_ribbon = 'oreville_auulis';
    d.textures.st_ribbon = 'textures/oreville/ans/dgz';
    d.geometry.st_ribbon = geometry.description.identifier;
    if (d.geometry[d.queryable_geometry] !== querySource.description.identifier) throw Error('Unexpected A&S sword query geometry: ' + name);
    d.geometry[d.queryable_geometry] = queryGeometry.description.identifier;
    d.scripts.initialize.push(toMolang(initialize()));
    d.scripts.pre_animation.push(preAnimation);
    d.scripts.animate.push('st_display', 'st_capture');
    d.animations.st_display = 'animation.sword_trail.display';
    d.animations.st_capture = 'controller.animation.sword_trail.capture';
    d.render_controllers.push('controller.render.sword_trail.ribbon');
    // Same relative filename as A&S, so the original and patched definitions
    // cannot compete as two distinct files with the same attachable identifier.
    write('attachables/' + f, original);
  }
  const dependency = read('manifest.json').header;
  write('manifest.json', { format_version: 2, header: { name: 'Sword Trail — A&S 1.13 Patch', description: 'Adds first- and third-person sword trails to Actions & Stuff 1.13. Place above Actions & Stuff.', uuid: '42030bb0-6af3-499b-a94e-af8b3c14668a', version: [0, 0, 3], min_engine_version: [1, 26, 40] }, modules: [{ type: 'resources', uuid: '908e5215-6792-4f70-885f-254cb129ddce', version: [0, 0, 3] }], dependencies: [{ uuid: dependency.uuid, version: typeof dependency.version === 'string' ? dependency.version.split('.').map(Number) : dependency.version }], capabilities: ['pbr'] });
  return { swords, captureCharacters: capture.length, triangles: SEGMENTS * 2, maximumExpressionCharacters: Math.max(capture.length, ...Object.values(animatedBones()).flatMap(b => Object.values(b).flat()).filter(v => typeof v === 'string').map(v => v.length)) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(build());
