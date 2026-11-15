import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {optimizePack} from '../../ClothPhysics/tools/pack/brarchive.mjs';
import {zip} from '../../ClothPhysics/tools/pack/zip.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const entries = [];
function collect(relative = '') {
  for (const entry of fs.readdirSync(path.join(root, 'src', relative), {withFileTypes: true})) {
    const name = relative + entry.name;
    if (entry.isDirectory()) collect(name + '/');
    else {
      let data = fs.readFileSync(path.join(root, 'src', name));
      if (/\.(?:json|material)$/.test(name)) data = Buffer.from(JSON.stringify(JSON.parse(data)));
      entries.push({name, data});
    }
  }
}
collect();
const archived = optimizePack(entries);
const output = path.join(root, 'pack', 'Slash Trail.mcpack');
fs.mkdirSync(path.dirname(output), {recursive: true});
const bytes = zip(archived);
fs.writeFileSync(output, bytes);
console.log(`Created ${output}\n${entries.length} source files; ${archived.filter(e => e.name.endsWith('.brarchive')).length} brarchives; ${bytes.length} ZIP bytes; ${archived.reduce((sum, e) => sum + e.data.length, 0)} unpacked bytes`);
