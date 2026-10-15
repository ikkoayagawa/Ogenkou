import type { RenderInput } from "../services/render-input-builder.js";

export interface SourcePosition { revision: number; key: string; offset: number }
export interface TextChange { start: number; end: number; text: string }
export function shiftOffset(offset: number, changes: readonly TextChange[]) {
  let delta=0;
  for(const c of [...changes].sort((a,b)=>a.start-b.start)) {
    if(offset<c.start) break;
    if(c.start===c.end&&offset===c.start) {delta+=c.text.length;continue;}
    if(offset<c.end) return {offset:c.start+delta,approximate:true};
    delta+=c.text.length-(c.end-c.start);
  }
  return {offset:offset+delta,approximate:false};
}
/** Editor versions, rather than render revisions, track skipped intermediate edits. */
export class SourceHistory {
  #edits=new Map<string,{version:number;changes:TextChange[]}[]>();
  record(uri:string,version:number,changes:TextChange[]) {
    const rows=this.#edits.get(uri)??[];rows.push({version,changes});
    if(rows.length>2000)rows.splice(0,rows.length-2000);this.#edits.set(uri,rows);
  }
  rebase(uri:string,offset:number,from:number|undefined,to:number) {
    if(from===to)return offset;
    if(from===undefined||from>to)return null;
    const rows=(this.#edits.get(uri)??[]).filter(r=>r.version>from&&r.version<=to);
    let version=from;
    for(const row of rows){if(row.version!==version+1)return null;offset=shiftOffset(offset,row.changes).offset;version=row.version;}
    return version===to?offset:null;
  }
}
export function resolveSource(input:RenderInput,position:SourcePosition) {
  if(position.revision!==input.document.revision||!Number.isSafeInteger(position.offset)||position.offset<0)return null;
  const mapping=input.document.mappings.find(m=>m.key===position.key);
  if(!mapping||position.offset>mapping.text.length)return null;
  const run=mapping.runs.find(r=>position.offset>=r.generatedStart&&position.offset<r.generatedEnd)??(position.offset===mapping.text.length?mapping.runs.at(-1):undefined);
  if(!run)return null;
  return {uri:mapping.uri,offset:run.sourceStart+(run.mode==="identity"?Math.min(position.offset-run.generatedStart,run.sourceEnd-run.sourceStart):0),
    version:input.snapshot.sources.find(s=>s.uri===mapping.uri)?.editorVersion};
}
