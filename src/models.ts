export interface CatalogModel {id:string;name:string;subtitle:string;path:string;thumbnail:string;source:string;sha256:string;bytes:number;morphs:number;license:string;terms:string;format:string;meta:unknown}
export const modelCatalog:CatalogModel[]=await fetch('./models/catalog.json').then(response=>{
  if(!response.ok)throw new Error('模型目录加载失败');return response.json();
});
