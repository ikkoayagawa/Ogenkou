import {createHash} from "node:crypto";
import {parse, serialize, type DefaultTreeAdapterMap} from "parse5";
import {createCoreMemoryInput} from "../services/core-memory-input.js";
import type {RenderInput} from "../services/render-input-builder.js";
import {memoryCss, srcsetReferences} from "../services/resource-references.js";

type Node = DefaultTreeAdapterMap["node"];
/** Captured resources receive stable, self-contained addresses in every realm.
 * Resource changes invalidate the compatibility key; no donor Blob is borrowed. */
export function previewInput(input: RenderInput, position: {uri:string;offset:number}) {
  const memory=createCoreMemoryInput(input);let dom=parse(memory.source.html),portable=true;
  const resources=new Map(memory.source.resources.map(r=>[r.url,r])),addresses=new Map<string,string>(),resolving=new Set<string>();
  const address=(value:string,base:string):string=>{
    if(!value||value.startsWith('#')||value.startsWith('data:'))return value;
    let parsed:URL;try{parsed=new URL(value,base);}catch{portable=false;return value;}
    const fragment=parsed.hash;parsed.hash='';const key=parsed.href,resource=resources.get(key);
    if(!resource){portable=false;return value;}
    if(addresses.has(key))return addresses.get(key)!+fragment;
    if(resolving.has(key))return 'data:text/css,';
    resolving.add(key);
    let content=resource.content;
    if(resource.mediaType==='text/css'&&typeof content==='string')content=memoryCss(content,key,uri=>address(uri,key));
    const result='data:'+(resource.mediaType??'application/octet-stream')+';base64,'+Buffer.from(typeof content==='string'?content:new Uint8Array(content)).toString('base64');
    resolving.delete(key);addresses.set(key,result);return result+fragment;
  };
  const visit=(node:Node)=>{
    if('attrs' in node)for(const attr of node.attrs){
      if(['src','poster','data'].includes(attr.name)||(attr.name==='href'&&node.tagName==='link'))attr.value=address(attr.value,memory.source.url);
      if(attr.name==='srcset')attr.value=srcsetReferences(attr.value).map(r=>address(r.url,memory.source.url)+(r.descriptor?' '+r.descriptor:'')).join(', ');
      if(attr.name==='style')attr.value=memoryCss(attr.value,memory.source.url,uri=>address(uri,memory.source.url));
    }
    if('tagName' in node&&node.tagName==='style')for(const child of node.childNodes)if('value' in child)child.value=memoryCss(child.value,memory.source.url,uri=>address(uri,memory.source.url));
    if('childNodes' in node)node.childNodes.forEach(visit);
  };visit(dom);
  if(!portable)dom=parse(memory.source.html);
  let selected: {key:string;offset:number;distance:number}|undefined;
  for(const mapping of input.document.mappings){
    if(mapping.uri!==position.uri||mapping.kind==="ruby-reading"||mapping.kind==="generated")continue;
    for(const run of mapping.runs){const distance=position.offset<run.sourceStart?run.sourceStart-position.offset:position.offset>run.sourceEnd?position.offset-run.sourceEnd:0;
      if(!selected||distance<selected.distance){const delta=Math.max(0,Math.min(run.sourceEnd-run.sourceStart,position.offset-run.sourceStart));
        selected={key:mapping.key,offset:Math.min(mapping.text.length-1,run.generatedStart+(run.mode==="identity"?delta:0)),distance};}}
  }
  let fragment:string|undefined;
  const entry=input.document.sourceMap.find(m=>m.key===selected?.key);
  if(entry&&selected){let cfiOffset=selected.offset;let node:Node|undefined=dom.childNodes.find(n=>"tagName" in n&&n.tagName==="html");const steps:number[]=[];
    for(const index of entry.path){if(!node||!("childNodes" in node)){node=undefined;break;}const children:Node[]=node.childNodes,next:Node|undefined=children[index];if(!next){node=undefined;break;}
      const before=children.slice(0,index),elements=before.filter(n=>"tagName" in n).length;
      steps.push(elements*2+("tagName" in next?2:1));
      if("value" in next)for(let i=index-1;i>=0&&!("tagName" in children[i]!);i--){const prior=children[i]!;if("value" in prior)cfiOffset+=prior.value.length;}
      node=next;
    }
    if(node)fragment="#epubcfi(/2!"+steps.map(n=>"/"+n).join("")+":"+Math.max(0,cfiOffset)+")";
  }
  const compatibilityKey="ogenkou-preview-v2:"+createHash("sha256").update(input.snapshot.work).update(JSON.stringify(memory.source.resources.map(r=>({url:r.url===memory.source.resources.at(-1)?.url?"publication.css":r.url,content:typeof r.content==="string"?r.content:Buffer.from(r.content).toString("base64")})))).digest("hex");
  return {...memory.source,html:serialize(dom),resources:portable?[]:memory.source.resources.map(r=>typeof r.content==="string"?r:{url:r.url,mediaType:r.mediaType,base64:Buffer.from(r.content).toString("base64")}),
    compatibilityKey,portable,fragment,headings:input.document.headings,direction:input.snapshot.config.readingProgression??(input.snapshot.settings.writingMode==="vertical"?"rtl":"ltr"),target:selected?{key:selected.key,offset:Math.max(0,selected.offset)}:undefined};
}
