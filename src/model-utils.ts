/** Some VRM 0.x exporters store targetNames on primitives, while GLTFLoader reads mesh extras. */
export function normalizeLegacyMorphNames(json:{meshes?:{extras?:{targetNames?:string[]};primitives:{extras?:{targetNames?:string[]};targets?:unknown[]}[]}[]}) {
  for(const mesh of json.meshes??[])if(!mesh.extras?.targetNames){
    const names=mesh.primitives.find(p=>p.extras?.targetNames?.length===p.targets?.length)?.extras?.targetNames;
    if(names)mesh.extras={...mesh.extras,targetNames:[...names]};
  }
}
export function canonicalMorphName(name:string):string {
  const match=name.match(/Fcl_(.+)$/i);
  if(!match)return name;
  const [region,...rest]=match[1].split('_');
  return `Fcl_${region.toUpperCase()}_${rest.join('_')}`;
}
