import { readFile, writeFile, rename, mkdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const models=JSON.parse(await readFile(path.join(root,'public/models/catalog.json'),'utf8'));
await mkdir(path.join(root,'public/models'),{recursive:true});
await Promise.all(models.map(async model=>{
  const destination=path.join(root,'public/models',model.id+'.vrm');
  try{const info=await stat(destination);if(info.size===model.bytes){const existing=await readFile(destination);if(createHash('sha256').update(existing).digest('hex')===model.sha256)return;}}catch{}
  console.log(`Downloading ${model.id} (${(model.bytes/1048576).toFixed(1)} MiB)...`);
  const response=await fetch(model.source,{signal:AbortSignal.timeout(90000)});
  if(!response.ok)throw new Error(`Could not download ${model.id}: HTTP ${response.status}. Use the full project archive if GitHub is unreachable.`);
  const data=Buffer.from(await response.arrayBuffer());
  if(data.length!==model.bytes||createHash('sha256').update(data).digest('hex')!==model.sha256)throw new Error(`Checksum mismatch for ${model.id}. The source may have changed; the file was not installed.`);
  const temporary=destination+'.download';await writeFile(temporary,data);await rename(temporary,destination);console.log(`${model.id} ready.`);
}));
console.log('All four bundled model checksums verified.');
