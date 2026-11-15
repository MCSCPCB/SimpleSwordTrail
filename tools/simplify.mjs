import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

export function simplify(files) {
  const metadata = files.get('simple_trail/project.json');
  if (!metadata) return files;
  const meta = JSON.parse(metadata);
  const ids = meta.files.filter(p => p.endsWith('.source.geo.json')).map(p => path.posix.basename(p).replace('.source.geo.json', ''));
  const rename = text => ids.reduce((value, id) => value.replaceAll(id, 'sword_trail'), text)
    .replaceAll('textures/simple_trail/sword_trail', 'textures/sword_trail/ribbon');
  const result = new Map(files);
  for (const name of meta.files) result.delete(name);
  result.delete('simple_trail/project.json');
  result.delete('models/entity/sword_query.geo.json');

  const resources = [
    [p => p.endsWith('.source.geo.json'), 'models/entity/sword_trail.source.geo.json'],
    [p => p.endsWith('.ribbon.geo.json'), 'models/entity/sword_trail.ribbon.geo.json'],
    [p => p.startsWith('animations/'), 'animations/sword_trail.animation.json'],
    [p => p.startsWith('animation_controllers/'), 'animation_controllers/sword_trail.animation_controllers.json'],
    [p => p.startsWith('render_controllers/'), 'render_controllers/sword_trail.render_controllers.json'],
    [p => p.endsWith('.png'), 'textures/sword_trail/ribbon.png'],
  ];
  for (const [matches, destination] of resources) {
    const names = meta.files.filter(matches);
    if (names.length !== ids.length) throw Error(`Incomplete resource group: ${destination}`);
    const values = names.map(name => destination.endsWith('.png') ? files.get(name) : Buffer.from(rename(files.get(name).toString('utf8'))));
    if (!values.every(value => value.equals(values[0]))) throw Error(`Swords need different resources: ${destination}`);
    result.set(destination, values[0]);
  }

  const encode = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
  for (const name of Object.keys(meta.originals)) {
    const doc = JSON.parse(rename(files.get(name).toString('utf8')));
    const scripts = doc['minecraft:attachable'].description.scripts;
    // All seven swords have the same constant client scale; calculate it once.
    const repeatedScale = ['x', 'y', 'z'].map(axis =>
      `t.sword_trail_client_size=(0.9375)*(1);v.sword_trail_units_${axis}=t.sword_trail_actor_units*(math.abs(t.sword_trail_client_size)>0.00001?t.sword_trail_client_size:1);`
    ).join('');
    scripts.pre_animation = scripts.pre_animation.map(text => text.replace(repeatedScale,
      'v.sword_trail_units_x=t.sword_trail_actor_units*0.9375;v.sword_trail_units_y=v.sword_trail_units_x;v.sword_trail_units_z=v.sword_trail_units_x;'));
    result.set(name, encode(doc));
  }

  const materials = JSON.parse(files.get('materials/entity.material'));
  let shared;
  for (const id of ids) {
    const key = id + '_ribbon:entity_emissive';
    const material = materials.materials[key];
    if (!material || (shared && JSON.stringify(material) !== JSON.stringify(shared))) throw Error('Trail materials differ.');
    shared = material;
    delete materials.materials[key];
  }
  materials.materials['sword_trail_ribbon:entity_emissive'] = shared;
  result.set('materials/entity.material', encode(materials));
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const root = fileURLToPath(new URL('../src/', import.meta.url));
  const files = new Map();
  function collect(relative = '') {
    for (const entry of fs.readdirSync(path.join(root, relative), {withFileTypes: true})) {
      const name = relative + entry.name;
      if (entry.isDirectory()) collect(name + '/');
      else files.set(name, fs.readFileSync(path.join(root, name)));
    }
  }
  collect();
  const result = simplify(files);
  const inside = name => {
    const target = path.resolve(root, name), relative = path.relative(root, target);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw Error(`Path outside src: ${name}`);
    return target;
  };
  const output = [...result].map(([name, data]) => [inside(name), data]);
  const removed = [...files.keys()].filter(name => !result.has(name)).map(inside);
  for (const [target, data] of output) {
    fs.mkdirSync(path.dirname(target), {recursive: true});
    fs.writeFileSync(target, data);
  }
  for (const target of removed) fs.unlinkSync(target);
  for (const target of removed) {
    let directory = path.dirname(target);
    while (path.relative(root, directory) && fs.existsSync(directory) && fs.readdirSync(directory).length === 0) {
      fs.rmdirSync(directory);
      directory = path.dirname(directory);
    }
  }
  const size = values => [...values.values()].reduce((total, data) => total + data.length, 0);
  console.log(`Simplified ${files.size} -> ${result.size} files; ${size(files)} -> ${size(result)} source bytes`);
}
