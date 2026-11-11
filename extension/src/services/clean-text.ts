import {parse} from "parse5";
import {compileVfmManuscript} from "../compiler/vfm-manuscript.js";
import {BUILTIN_PUBLICATION} from "../config/publication-editor.js";
import {naturalCompare} from "./snapshot-builder.js";
import type {WorkSnapshot} from "./snapshot-builder.js";


/** Leave parent text, including empty readings inserted by the ruby command. */
function stripNotation(text:string):string {
 return text
  .replace(/\[\[rb:([^>\r\n]+)>([^\]\r\n]*)\]\]/gu,'$1')
  .replace(/(?:[｜|]([^｜|《》\r\n]+)|([\p{Script=Han}々〆ヵヶ]+))《([^《》\r\n]*)》/gu,(_,base,kanji)=>base??kanji)
  .replace(/\[\[emphasismark:([^>\]\r\n]+)(?:>[^\]\r\n]*)?\]\]/gu,'$1')
  .replace(/《《([^\r\n]+?)》》/gu,'$1')
  .replace(/\{([^{}|\r\n]+)\|[^{}\r\n]*\}/gu,'$1')
  .replace(/［＃[^］\r\n]*］/gu,'')
  .replace(/\[\[jumpuri:([^>\r\n]+)>[^\]\r\n]*\]\]/gu,'$1')
  .replace(/\[chapter:([^\]\r\n]*)\]/gu,'$1')
  .replace(/\[(?:b|i):([^\]\r\n]*)\]/gu,'$1')
  .replace(/\[(?:newpage|jump:\d+|pixivimage:[^\]\r\n]*|uploadedimage:[^\]\r\n]*)\]/gu,'');
}

/** Use the production Markdown/HTML parser without adding generated book content. */
export function cleanManuscriptText(source:string):string {
 const text=stripNotation(source.replace(/^\uFEFF/u,'').replace(/\r\n?|\n/gu,'\n'));
 const settings=structuredClone(BUILTIN_PUBLICATION);
 Object.assign(settings.processing,{titlePage:false,toc:false,hardLineBreaks:true,preserveEmptyLines:true,preserveLineIndent:true,connectedDashes:false,verticalQuotes:false,automaticTcy:false,kanaMarks:false});
 const snapshot:WorkSnapshot={work:"file:///clean-text/",epoch:1,revision:1,fingerprint:"clean-text",content:text,boundaries:[],sources:[{uri:"file:///clean-text/manuscript.novel",text,virtualStart:0,virtualEnd:text.length,dirty:true}],configText:"{}",config:{theme:[],quickPreview:true,overrides:{}},settings,rawSettings:settings,resources:[],resourceManifestComplete:false};
 const dom=parse(compileVfmManuscript(snapshot).html);
 type Node={nodeName:string;value?:string;tagName?:string;attrs?:{name:string;value:string}[];childNodes?:Node[]};
 const blocks=new Set(['p','h1','h2','h3','h4','h5','h6','li','blockquote','div','section','article','pre','table','tr','ul','ol','dl','dt','dd']);
 let output='';const newline=()=>{if(output&&!output.endsWith('\n'))output+='\n';};
 const visit=(node:Node)=>{
  const tag=node.tagName;
  if(['head','script','style','rt','rp','template'].includes(tag??''))return;
  if(node.nodeName==='#text'){if(node.value)output+=node.value;return;}
  if(tag==='br'){output+='\n';return;}
  if(tag==='hr'){newline();output+='\n';return;}
  if(tag==='img'){output+=node.attrs?.find(a=>a.name==='alt')?.value??'';return;}
  if(node.attrs?.some(a=>a.name==='class'&&a.value.split(/\s+/u).includes('source-blank-line'))){output+='\n';return;}
  const block=blocks.has(tag??'');if(block)newline();
  for(const child of node.childNodes??[]){
   // Serializer whitespace between block elements is not a manuscript blank line.
   if(child.nodeName==='#text'&&/^\s*$/u.test(child.value??'')&&['html','body','section','div','ul','ol','table','tbody','thead','tr'].includes(tag??''))continue;
   visit(child);
  }
  if(tag==='td'||tag==='th')output+='\t';
  if(tag==='tr')output=output.replace(/\t+$/u,'');
  if(block)newline();
 };
 visit(dom as unknown as Node);
 return stripNotation(output).replace(/\n+$/u,'');
}

export function mergeCleanManuscripts(files:readonly {name:string;text:string}[]):string {
 return [...files].sort((a,b)=>naturalCompare(a.name,b.name)).map(f=>cleanManuscriptText(f.text)).filter(Boolean).join('\n\n')+'\n';
}
