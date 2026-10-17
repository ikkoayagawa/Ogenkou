import {isMap, isSeq, isScalar, parseDocument, stringify,type YAMLMap} from 'yaml';

export const COLOPHON_FILENAME = '99_okuduke.yaml';
export const COLOPHON_STYLESHEET = 'styles/colophon.css';
export const isYamlSource = (uri:string) => /\.ya?ml$/iu.test(new URL(uri).pathname);
export const isWorkSource = (uri:string) => /\.(?:novel|nv|yaml|yml)$/iu.test(new URL(uri).pathname);
export interface ColophonText {value:string;start:number;end:number}
export interface Colophon {title?:ColophonText;date?:ColophonText;items:{name:ColophonText;content:ColophonText}[];rule:boolean;notice?:ColophonText}

/** Only explicitly marked YAML is a manuscript. Unrelated YAML stays untouched. */
export function parseColophon(text:string):Colophon|undefined {
  const marked=/^template\s*:/mu.test(text.replace(/^\uFEFF/u,''));
  if(text.length>262144){if(marked)throw new Error('奥付YAMLは256Ki文字以内にしてください。');return undefined;}
  const doc=parseDocument(text,{schema:'core',uniqueKeys:true,prettyErrors:false});
  if(!isMap(doc.contents)||!doc.contents.has('template')){
    if(marked)throw new Error('奥付YAMLの書式を確認してください。');
    return undefined;
  }
  if(doc.errors.length||doc.warnings.length)throw new Error('奥付YAML: '+(doc.errors[0]??doc.warnings[0])!.message);
  if(doc.get('template')!=='okuduke')throw new Error('奥付YAMLの template は okuduke を指定してください。');
  const top=doc.contents;
  const checkKeys=(map:YAMLMap<unknown,unknown>,allowed:string[])=>{for(const pair of map.items){if(!isScalar(pair.key)||typeof pair.key.value!=='string'||!allowed.includes(pair.key.value))throw new Error('奥付YAMLに未対応の項目があります: '+String(isScalar(pair.key)?pair.key.value:''));}};
  checkKeys(top,['template','書名','発行日','項目','罫線','注意書き']);
  function field(node:unknown,label:string,required=false):ColophonText|undefined {
    if(node===undefined&&!required)return undefined;
    if(!isScalar(node)||typeof node.value!=='string')throw new Error('奥付YAMLの「'+label+'」は文字列で指定してください。');
    return {value:node.value,start:node.range?.[0]??0,end:node.range?.[1]??text.length};
  }
  const items:Colophon['items']=[], entries=top.get('項目',true);
  if(entries!==undefined){
    if(!isSeq(entries)||entries.items.length>100)throw new Error('奥付YAMLの「項目」は100件以内の一覧で指定してください。');
    for(const node of entries.items){
      if(!isMap(node))throw new Error('奥付YAMLの各項目には「名前」と「内容」を指定してください。');
      checkKeys(node,['名前','内容']);
      items.push({name:field(node.get('名前',true),'名前',true)!,content:field(node.get('内容',true),'内容',true)!});
    }
  }
  const rule=top.get('罫線');
  if(rule!==undefined&&typeof rule!=='boolean')throw new Error('奥付YAMLの「罫線」は true または false を指定してください。');
  return {title:field(top.get('書名',true),'書名'),date:field(top.get('発行日',true),'発行日'),items,rule:rule??true,notice:field(top.get('注意書き',true),'注意書き')};
}

export function colophonTemplate(title:string,author:string,date=new Date()):string {
  const parts=new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',year:'numeric',month:'numeric',day:'numeric'}).formatToParts(date);
  const value=(kind:string)=>parts.find(p=>p.type===kind)?.value??'';
  return '# template の行は変更しないでください。\n# 見た目の変更は styles/colophon.css の .colophon 以下で行えます。\n'+stringify({template:'okuduke',書名:title||'書名を入力してください',発行日:`${value('year')}年${value('month')}月${value('day')}日 初版発行`,項目:[{名前:'著者',内容:author||'著者名を入力してください'},{名前:'発行サークル',内容:'サークル名を入力してください'}],罫線:true,注意書き:'本文・図版の無断転載を禁じます。'});
}

// Shipped defaults also work for a YAML file added without using the GUI.
export const COLOPHON_CSS = `
@page ogenkou-colophon { margin: 12mm; --vivliostyle-page-content-writing-mode: horizontal-tb; --vivliostyle-page-content-column-count: 1;
${['top-left-corner','top-left','top-center','top-right','top-right-corner','bottom-left-corner','bottom-left','bottom-center','bottom-right','bottom-right-corner'].map(box=>'  @'+box+' { content: none; }').join('\n')}
}
.colophon { page: ogenkou-colophon; break-before: page; break-after: page; column-span: all; writing-mode: horizontal-tb; width: 70mm; max-width: 100%; font-size: 9pt; font-weight: 400; line-height: 1.5; text-align: start; }
.colophon h1 { break-before: auto; break-after: avoid; string-set: none; font-size: 14pt; font-weight: 400; margin: 0 0 5mm; }
.colophon p { text-indent: 0; margin: 0 0 3mm; }
.colophon dl { margin: 0; }
.colophon dt { margin-top: 2mm; }
.colophon dd { margin: 0 0 0 1em; white-space: pre-wrap; }
.colophon hr { border: 0; border-top: .2mm solid #444; margin: 4mm 0; }
.colophon a { color: inherit; text-decoration: none; }
.colophon .notice { font-size: 7pt; white-space: pre-wrap; }
`;
