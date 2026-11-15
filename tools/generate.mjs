import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {defaults} from '../../Simple-Trail/src/config.js';
import {generate} from '../../Simple-Trail/src/export.js';
import {indexResources} from '../../Simple-Trail/src/resources.js';
import {simplify} from './simplify.mjs';
import {firstPersonSwordAttack} from './first-person-attack.mjs';
import {firstPersonSwordHold} from './first-person-hold.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const sample = path.resolve(root, '../ClothPhysics/_sample/[英文]Actions and Stuff 1.13');
const example = path.resolve(root, '../Simple-Trail/example/sword');
const encode = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const read = (directory, name) => fs.readFileSync(path.join(directory, name));
const asModel = JSON.parse(read(sample, 'models/entity/464e95f9.json'))
  ['minecraft:geometry'].find(g => g.description.identifier === 'geometry.oreville_ans.kglzcj');
const vanillaModel = JSON.parse(read(example, 'models/entity/sword.geo.json'))['minecraft:geometry'][0];
const vanillaAttachable = JSON.parse(read(example, 'attachables/diamond_sword.json'));
const swordFiles = ['ewx', 'eyc', 'flt', 'fqy', 'fvm', 'ggn', 'gkx'];

function profile(actionsAndStuff) {
  const files = new Map(), configs = [];
  const model = actionsAndStuff ? asModel : vanillaModel;
  for (const file of swordFiles) {
    // Use matching paths so the A&S subpack replaces each complete definition.
    const name = `attachables/${file}.json`;
    const original = JSON.parse(read(sample, name));
    const source = original['minecraft:attachable'].description;
    const doc = actionsAndStuff ? original : structuredClone(vanillaAttachable);
    const d = doc['minecraft:attachable'].description;
    if (!actionsAndStuff) {
      d.identifier = source.identifier;
      const item = source.identifier.split(':')[1];
      d.textures.default = 'textures/items/' + ({wooden_sword: 'wood_sword', golden_sword: 'gold_sword'}[item] ?? item);
    }
    if (d.geometry[d.queryable_geometry] !== model.description.identifier) throw Error(`Unexpected query model: ${d.identifier}`);
    files.set(name, encode(doc));
    const config = defaults(d.identifier, d.queryable_geometry, model);
    config.points = {a: {bone: 'sword', position: [0, 9, 0]}, b: {bone: 'sword', position: [0, 20.5, 0]}};
    if (actionsAndStuff) config.emitCondition += '&&!v.jvsiul';
    configs.push(config);
  }
  files.set('models/entity/sword_query.geo.json', encode({format_version: '1.16.0', 'minecraft:geometry': [model]}));
  if (actionsAndStuff) files.set('materials/entity.material', read(sample, 'materials/entity.material'));
  else files.set('animations/sword_hold.animation.json', encode(firstPersonSwordHold(
    JSON.parse(read(example, 'animations/item.animation.json')), model
  )));
  const exported = generate(indexResources(files), configs);
  return simplify(new Map([...exported.files].map(([name, data]) => [name, Buffer.from(data)])));
}

const vanilla = profile(false), as = profile(true), output = new Map(vanilla);
let overrides = 0;
for (const [name, data] of as) {
  if (vanilla.get(name)?.equals(data)) continue;
  output.set('subpacks/actions_and_stuff_1_13/' + name, data);
  overrides++;
}
output.set('subpacks/default/texts/languages.json', read(path.join(root, 'src'), 'texts/languages.json'));
const swordItems = swordFiles.map(file => JSON.parse(vanilla.get(`attachables/${file}.json`))['minecraft:attachable'].description.identifier);
for (const [name, data] of firstPersonSwordAttack(swordItems, read(example, 'animations/attack.animation.json'))) {
  output.set(name, data);
}

for (const [name, data] of output) {
  const destination = path.join(root, 'src', name);
  fs.mkdirSync(path.dirname(destination), {recursive: true});
  fs.writeFileSync(destination, data);
}
console.log(`Generated default and A&S profiles with Simple Trail: 7 swords each, ${overrides} A&S override files; shared trail resources stored once.`);
