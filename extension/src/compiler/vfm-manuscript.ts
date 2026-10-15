import { VFM, readMetadata } from "@vivliostyle/vfm";
import { memoryCss, srcsetReferences } from "../services/resource-references.js";
import { discoverHtmlResources } from "../services/resource-discovery.js";
import { mdast as vfmToc } from "@vivliostyle/vfm/lib/plugins/toc.js";
import { parse, parseFragment, serialize } from "parse5";
import { createHash, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { immutable } from "../services/contracts.js";
import type { WorkSnapshot } from "../services/snapshot-builder.js";
import type { CompiledDocument, TextMapping, MappingRun, Heading } from "./manuscript.js";
import { createPublicationCss } from "./publication-css.js";
import { applyNotationToText, applyVerticalTypographyToText } from "./legacy-japanese.js";

// The VFM/unified and HTML parser boundaries use their external tree shapes.
type Tree = { type: string; value?: string; tagName?: string; properties?: Record<string, any>; children?: Tree[];
  position?: { start: { offset: number }; end: { offset: number } } };
type HtmlNode = any;
const el = (tagName: string, children: Tree[] = [], properties: Record<string, any> = {}): Tree => ({ type: "element", tagName, properties, children });
const escape = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const plain = (n: Tree): string => n.type === "text" ? n.value ?? "" : n.tagName === "rt" || n.tagName === "rp" ? "" : (n.children ?? []).map(plain).join("");

/** VFM grammar, old Ogenkou Japanese transforms, and a body-first Core sidecar. */
export function compileVfmManuscript(snapshot: WorkSnapshot, onTiming?: (phase: string, milliseconds: number) => void): CompiledDocument {
  let phaseStart=performance.now();const timing=(phase:string)=>{const now=performance.now();onTiming?.(phase,now-phaseStart);phaseStart=now;};
  const settings = snapshot.settings.processing, headings: Heading[] = [], diagnostics: CompiledDocument["diagnostics"] = [], resources: CompiledDocument["resourceRequests"] = [];
  const frontMatter = /^(?:\uFEFF)?---[ \t]*\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/u.exec(snapshot.sources[0]?.text ?? "")?.[0];
  const metadata = frontMatter ? readMetadata(frontMatter, ["author"]) : {};
  const documentTitle = snapshot.config.title ?? metadata.title ?? "";
  const documentAuthor = snapshot.config.author ?? (typeof metadata.custom?.author === "string" ? metadata.custom.author : "");
  const headLimit = snapshot.settings.layout.runningHeadMaxLength ?? "14";
  const refs = new Map<string, TextMapping>(), marked = new WeakMap<object, TextMapping>();
  const marker = "data-ogenkou-map-" + randomUUID().replaceAll("-", "");
  let serial = 0;
  const make = (uri: string, value: string, runs: MappingRun[], kind: TextMapping["kind"] = "text"): TextMapping =>
    ({ key: createHash("sha256").update(uri).digest("hex").slice(0, 24) + ":" + serial++, uri, text: value, runs, kind });
  const mapped = (map: TextMapping): Tree => { const node: Tree = { type: "text", value: map.text }; marked.set(node, map); return node; };
  function compact(runs: MappingRun[]): MappingRun[] {
    const out: MappingRun[] = [];
    for (const r of runs) { const p = out.at(-1);
      if (p?.mode === "identity" && r.mode === "identity" && p.sourceEnd === r.sourceStart && p.generatedEnd === r.generatedStart) { p.generatedEnd = r.generatedEnd; p.sourceEnd = r.sourceEnd; }
      else out.push({ ...r });
    } return out;
  }
  function slice(map: TextMapping, start: number, end: number, value = map.text.slice(start, end), kind = map.kind): TextMapping {
    const runs: MappingRun[] = [];
    for (const r of map.runs) {
      const a = Math.max(start, r.generatedStart), b = Math.min(end, r.generatedEnd); if (a >= b) continue;
      const identity = r.mode === "identity", original = map.text.slice(a, b), replacement = value.slice(a - start, b - start);
      if(identity&&original!==replacement&&original.length===replacement.length){
        for(let i=0;i<original.length;i++)runs.push({generatedStart:a-start+i,generatedEnd:a-start+i+1,sourceStart:r.sourceStart+a-r.generatedStart+i,sourceEnd:r.sourceStart+a-r.generatedStart+i+1,mode:original[i]===replacement[i]?"identity":"range"});
      }else runs.push({ generatedStart: a - start, generatedEnd: b - start, sourceStart: identity ? r.sourceStart + a - r.generatedStart : r.sourceStart,
        sourceEnd: identity ? r.sourceStart + b - r.generatedStart : r.sourceEnd, mode: identity && original === replacement ? "identity" : "range" });
    }
    return make(map.uri, value, compact(runs), kind);
  }
  function originalMap(uri: string, source: string, value: string, start: number, end: number): TextMapping {
    const runs: MappingRun[] = []; let cursor = start, target = 0;
    while (target < value.length && cursor < end) {
      let output = source[cursor]!, consumed = 1;
      if (output === "\r") { output = "\n"; consumed = source[cursor + 1] === "\n" ? 2 : 1; }
      else if (output === "\\" && /[!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~]/u.test(source[cursor + 1] ?? "")) { output = source[cursor + 1]!; consumed = 2; }
      else if (output === "&") {
        const entity = /^&(?:#[xX][\da-fA-F]+|#\d+|[a-zA-Z][\da-zA-Z]*);/u.exec(source.slice(cursor, end));
        if (entity) { const fragment = parseFragment(entity[0]); const first = fragment.childNodes[0] as any; if (first?.nodeName === "#text") { output = first.value; consumed = entity[0].length; } }
      }
      if (value.slice(target, target + output.length) !== output) {
        // Structural whitespace removed by Markdown is skipped within this node's own range.
        if (/\s/u.test(source[cursor]!)) { cursor++; continue; }
        // Generated/normalized content remains an explicit range, never a false exact offset.
        runs.push({ generatedStart: target, generatedEnd: value.length, sourceStart: cursor, sourceEnd: end, mode: "range" }); target = value.length; break;
      }
      runs.push({ generatedStart: target, generatedEnd: target + output.length, sourceStart: cursor, sourceEnd: cursor + consumed,
        mode: consumed === output.length && source.slice(cursor, cursor + consumed) === output ? "identity" : "range" });
      target += output.length; cursor += consumed;
    }
    if (target < value.length) runs.push({ generatedStart: target, generatedEnd: value.length, sourceStart: start, sourceEnd: end, mode: "range" });
    return make(uri, value, compact(runs));
  }
  function notation(node: Tree, map: TextMapping): Tree[] {
    const result = applyNotationToText(map.text, settings) as Tree[]; let cursor = 0;
    for (const part of result) {
      if (part.type === "text") { marked.set(part, slice(map, cursor, cursor + part.value!.length)); cursor += part.value!.length; continue; }
      const classes = part.properties?.className ?? [];
      if (part.tagName === "ruby") {
        const match = /^(?:\[\[rb:([^>]+)>([^\]]+)\]\]|[｜|]([^《]+)《([^》]+)》|([\p{Script=Han}々〆ヵヶ]+)《([^》]+)》)/u.exec(map.text.slice(cursor))!;
        const bracket = match[1] !== undefined, pipe = match[3] !== undefined, base = match[1] ?? match[3] ?? match[5]!;
        const baseStart = cursor + (bracket ? 5 : pipe ? 1 : 0), baseMap = slice(map, baseStart, baseStart + base.length, base, "ruby-base");
        marked.set(part.children![0]!, baseMap);
        const reading = part.children![1]!.children![0]!;
        const start = baseMap.runs[0]?.sourceStart ?? 0, end = baseMap.runs.at(-1)?.sourceEnd ?? start;
        marked.set(reading, make(map.uri, reading.value!, [{generatedStart:0,generatedEnd:reading.value!.length,sourceStart:start,sourceEnd:end,mode:"range"}], "ruby-reading"));
        cursor += match[0].length;
      } else if (classes.includes("ogenkou-emphasis")) {
        const match = /^(?:《《([^\r\n]+?)》》|\[\[emphasismark:([^>\]]+)(?:>[^\]]*)?\]\])/u.exec(map.text.slice(cursor))!;
        const start = cursor + (match[1] !== undefined ? 2 : 15), label = part.children![0]!;
        marked.set(label, slice(map, start, start + label.value!.length)); cursor += match[0].length;
      } else { const label = part.children![0]!; marked.set(label, slice(map, cursor, cursor + label.value!.length, label.value!)); cursor += label.value!.length; }
    } return result;
  }
  function japanese(node: Tree, excluded = false): void {
    const stop = excluded || ["script","style","pre","code","rt","rp","textarea","svg","math"].includes(node.tagName ?? "");
    if (!node.children || stop) return;
    node.children = node.children.flatMap(child => {
      const map = marked.get(child);
      if (child.type !== "text" || !map) { japanese(child, stop); return [child]; }
      const parts = node.tagName === "ruby" ? [child] : notation(child, map);
      const typography = (part: Tree): void => {
        if (part.tagName === "rt" || part.tagName === "rp") return;
        if (part.children) part.children = part.children.flatMap(c => {
          if (c.type !== "text" || !marked.has(c)) { typography(c); return [c]; } return vertical(c);
        });
      };
      function vertical(c: Tree): Tree[] {
        const base = marked.get(c)!; const out = applyVerticalTypographyToText(base.text, settings) as Tree[]; let offset = 0;
        for (const p of out) {
          if (p.type === "text") { marked.set(p, slice(base, offset, offset + p.value!.length, p.value!)); offset += p.value!.length; }
          else { const first = p.children![0]!, mark = p.children![1]!.children![0]!; marked.set(first, slice(base, offset, offset+1)); marked.set(mark, slice(base, offset+1, offset+2)); offset += 2; }
        } return out;
      }
      return parts.flatMap(p => { if (p.type === "text") return vertical(p); typography(p); return [p]; });
    });
  }
  const roots: Tree[] = [];
  for (const source of snapshot.sources) {
    const uri = source.uri, input = source.text, prefix = createHash("sha256").update(uri).digest("hex").slice(0,16);
    // Like old Ogenkou, preserve bracket ruby/emphasis as text instead of VFM shortcodes.
    function shortcodeAdapter(this: any, ...args: any[]) {
      const transform = (vfmToc as any).apply(this, args), parser = this.Parser?.prototype, original = parser?.blockTokenizers?.shortcode;
      if (original) { function tokenizer(this: any, eat: any, value: string, silent: any) { if (/^\[\[(?:rb:|emphasismark:)/u.test(value)) return undefined; return original.call(this,eat,value,silent); }
        (tokenizer as any).locator = original.locator; parser.blockTokenizers.shortcode = tokenizer; }
      return transform;
    }
    function prepare() { return (tree: Tree) => {
      const visit = (n: Tree) => {
        if(n.type==="linkReference"&&/^(?:rb:|emphasismark:)/u.test((n as any).identifier??"")&&n.position){n.type="text";n.value=input.slice(n.position.start.offset,n.position.end.offset);delete n.children;}
        if (n.children) { n.children = n.children.filter(c => c.type !== "shortcode" && c.type !== "yaml"); n.children.forEach(visit); }
        if (n.type === "paragraph" && !settings.preserveLineIndent) {
          const trim = (c: Tree) => { if(c.type === "text") c.value = c.value!.replace(/^[ \t　]+|(?<=\n)[ \t　]+/gu, ""); else c.children?.forEach(trim); }; n.children?.forEach(trim);
        }
      }; visit(tree);
      if (settings.preserveEmptyLines) {
        const lines = [...input.matchAll(/([^\r\n]*)(\r\n|\r|\n|$)/gu)].filter(m=>m[0].length), children: Tree[] = []; let index=0;
        for (const child of tree.children ?? []) {
          const start = child.position?.start.offset ?? 0;
          while(index<lines.length && lines[index]!.index!<start) { const line=lines[index++]!; if(/^[ \t　]*$/u.test(line[1]!)) children.push({type:"html",value:'<p class="source-blank-line" aria-hidden="true">&#160;</p>'}); }
          children.push(child); while(index<lines.length && lines[index]!.index!<(child.position?.end.offset ?? start)) index++;
        }
        while(index<lines.length) { const line=lines[index++]!; if(/^[ \t　]*$/u.test(line[1]!)) children.push({type:"html",value:'<p class="source-blank-line" aria-hidden="true">&#160;</p>'}); } tree.children=children;
      }
    }; }
    const processor = VFM({ partial:true, disableFormatHtml:true, hardLineBreaks:false, mathRenderer:"mathml",
      editPlugins: plugins => ({...plugins, mdastPlugins: [...plugins.mdastPlugins.map(p=>p===vfmToc ? shortcodeAdapter as any : p), prepare as any],
        mdastToHastHandlers: {...plugins.mdastToHastHandlers, text: ((_h: any, node: Tree) => {
          const start=node.position?.start.offset, end=node.position?.end.offset;
          if(start===undefined||end===undefined) return {type:"text",value:node.value};
          const map=originalMap(uri,input,node.value!,start,end), id=String(refs.size); refs.set(id,map);
          return el("span", [{type:"text",value:map.text}], {id:marker+id});
        }) as any}}) });
    const tree = processor.runSync(processor.parse(input)) as unknown as Tree;
    timing("vfm-and-input-mapping");
    const unwrap = (n: Tree) => { if(!n.children)return; n.children=n.children.flatMap(c=>{
      unwrap(c); const id=c.properties?.id; if(typeof id!=="string"||!id.startsWith(marker))return [c]; const map=refs.get(id.slice(marker.length));
      return map ? [mapped(map)] : [c];
    });
      const merged:Tree[]=[];for(const c of n.children){const p=merged.at(-1),pm=p&&marked.get(p),cm=marked.get(c);
        if(p?.type==="text"&&c.type==="text"&&pm&&cm&&pm.uri===cm.uri){const shift=pm.text.length;pm.text+=cm.text;pm.runs.push(...cm.runs.map(r=>({...r,generatedStart:r.generatedStart+shift,generatedEnd:r.generatedEnd+shift})));pm.runs=compact(pm.runs);p.value=pm.text;}
        else merged.push(c);
      }n.children=merged;
    }; unwrap(tree);
    // Newline text is split after Markdown parsing, so both ASCII and fullwidth indent survive.
    const breaks = (n: Tree, excluded=false) => {
      const stop=excluded||["pre","code","script","style","math"].includes(n.tagName??""); if(!n.children||stop)return;
      n.children=n.children.filter((c,i)=>!(i>0&&n.children![i-1]!.tagName==="br"&&c.type==="text"&&c.value==="\n"&&!marked.has(c)));
      n.children=n.children.flatMap(c=>{breaks(c,stop); const map=marked.get(c); if(!map||!map.text.includes("\n"))return [c];
        if(!settings.hardLineBreaks)return [mapped(slice(map,0,map.text.length,map.text.replaceAll("\n"," ")))];
        const out:Tree[]=[];let start=0;for(let i=0;i<map.text.length;i++)if(map.text[i]==="\n"){if(i>start)out.push(mapped(slice(map,start,i)));out.push(el("br"));start=i+1;}if(start<map.text.length)out.push(mapped(slice(map,start,map.text.length)));return out;
      });
    }; breaks(tree); japanese(tree);
    const ids = new Map<string,string>();
    const inspect = (n: Tree) => {
      if(n.tagName==="ruby"){
        const base=(function find(c:Tree):TextMapping|undefined{return marked.get(c)??c.children?.filter(x=>x.tagName!=="rt"&&x.tagName!=="rp").map(find).find(Boolean)})(n);
        if(base){base.kind="ruby-base";const follow=(c:Tree)=>{const m=marked.get(c)??(c.type==="text"?make(base.uri,c.value??"",[],"ruby-reading"):undefined);if(m){m.kind="ruby-reading";m.runs=[{generatedStart:0,generatedEnd:m.text.length,sourceStart:base.runs[0]?.sourceStart??0,sourceEnd:base.runs.at(-1)?.sourceEnd??0,mode:"range"}];marked.set(c,m);}c.children?.forEach(follow);};n.children?.filter(c=>c.tagName==="rt").forEach(follow);}
      }
      if(/^h[1-6]$/u.test(n.tagName??"")) {
        const title=plain(n), chars=Array.from(title.trim()), properties=n.properties??={}; const old=String(properties.id??headings.length), id="h-"+prefix+"-"+old;
        properties.id=id;properties.dataRunningHead=headLimit!==""&&chars.length>Number(headLimit)?chars.slice(0,Math.max(0,Number(headLimit)-1)).join("")+"…":chars.join("");ids.set(old,id);
        const ranges:MappingRun[]=[];const all=(c:Tree)=>{if(c.tagName==="rt"||c.tagName==="rp")return;const m=marked.get(c);if(m)ranges.push(...m.runs);c.children?.forEach(all);};all(n);
        let offset=ranges.length?Infinity:0,end=ranges.length?0:input.length;for(const range of ranges){offset=Math.min(offset,range.sourceStart);end=Math.max(end,range.sourceEnd);}
        headings.push({id,level:Number(n.tagName![1]),title,uri,offset,end});
      }
      n.children?.forEach(inspect);
    }; inspect(tree);
    const urls=(n:Tree)=> { const props=n.properties;
      if(props)for(const attribute of ["src","href","poster","xLinkHref"]) { const value=props[attribute];if(typeof value!=="string")continue;
        if(value.startsWith("#")){let fragment=value.slice(1);try{fragment=decodeURIComponent(fragment)}catch{} if(ids.has(fragment))props[attribute]="#"+ids.get(fragment);continue;}
        try {const destination=new URL(value,uri).href;if(!/^(?:file:|https?:|mailto:|data:)/u.test(destination)){delete props[attribute];diagnostics.push({uri,start:0,end:input.length,message:"未対応の資源／リンクURLです。"});continue;}props[attribute]=destination;
          if(attribute==="src")resources.push({uri:destination,sourceUri:uri,start:0,end:input.length});
        }catch{delete props[attribute];}
      }
      if(props) {
        for(const attribute of ["srcSet","imageSrcSet"]) {
          const value=props[attribute];const inputValue=Array.isArray(value)?value.join(", "):value;
          if(typeof inputValue==="string")props[attribute]=srcsetReferences(inputValue).map(ref=>{
            try{return new URL(ref.url,uri).href+(ref.descriptor?" "+ref.descriptor:"");}catch{return ref.url;}
          }).join(", ");
        }
        for(const attribute of ["style","fill","stroke","filter","clipPath","mask","cursor","markerStart","markerMid","markerEnd"])
          if(typeof props[attribute]==="string")props[attribute]=memoryCss(props[attribute] as string,uri);
      }
      if(n.tagName==="style")for(const child of n.children??[])if(child.type==="text"&&typeof child.value==="string")child.value=memoryCss(child.value,uri);
      n.children?.forEach(urls);
    }; urls(tree); roots.push(tree);timing("body-adapter");
  }
  const body:Tree = el("body",roots.flatMap((r,i)=>[...(r.children??[]),...(i<roots.length-1?[el("p",[el("br")],{className:["source-blank-line"]})]:[])]));
  const tocDepth=settings.tocDepth??3;
  if(settings.toc!==false&&headings.some(h=>h.level<=tocDepth))body.children!.unshift(el("nav",[el("h1",[{type:"text",value:"目次"}],{className:["ogenkou-toc-title"]}),el("ol",headings.filter(h=>h.level<=tocDepth).map(h=>{
    const map=make(h.uri,h.title,[{generatedStart:0,generatedEnd:h.title.length,sourceStart:h.offset,sourceEnd:h.end,mode:"range"}],"generated");
    return el("li",[el("a",[el("span",[mapped(map)],{className:["ogenkou-toc-label"]}),el("span",[],{className:["ogenkou-toc-page"],dataTarget:"#"+h.id})],{href:"#"+h.id})],{className:["ogenkou-toc-entry"],dataSectionLevel:String(h.level)});
  }),{className:["ogenkou-toc-list"]})],{className:["ogenkou-toc"],role:"doc-toc"}));
  if(settings.titlePage!==false && documentTitle.trim()) body.children!.unshift(el("section",[el("div",[el("p",[{type:"text",value:documentTitle}],{className:["ogenkou-title-text"]}),...(documentAuthor?[el("p",[{type:"text",value:documentAuthor}],{className:["ogenkou-title-author"]})]:[])],{className:["ogenkou-title-content"]})],{className:["ogenkou-title-page"],role:"doc-cover"}));
  if (!body.children!.length) body.children!.push(el("p",[el("br")],{className:["ogenkou-empty-manuscript"],ariaHidden:"true"}));
  // Serialize through VFM's own HAST serializer, but temporary map markers never enter final HTML.
  const mark=(n:Tree)=>{if(!n.children)return;n.children=n.children.map(c=>{mark(c);const map=marked.get(c);if(!map)return c;const id=String(refs.size);refs.set(id,map);return el("span",[c],{id:marker+id});});};mark(body);
  const serializer=VFM({partial:true,disableFormatHtml:true});
  const fragment=serializer.stringify({type:"root",children:[body]} as any);
  timing("serialize-with-map-markers");
  const document=parse('<!doctype html><html lang="'+escape(snapshot.config.language??"ja")+'"><head><meta charset="utf-8"><title>'+escape(documentTitle)+'</title></head>'+fragment+'</html>');
  const domMaps=new WeakMap<object,TextMapping>();
  const clean=(n:HtmlNode)=>{
    if(!n.childNodes)return;n.childNodes=n.childNodes.flatMap((c:HtmlNode)=>{
      clean(c);const attr=c.attrs?.find((a:any)=>a.name==="id"&&a.value.startsWith(marker));if(!attr)return[c];const map=refs.get(attr.value.slice(marker.length));
      if(map&&c.childNodes?.length===1&&c.childNodes[0].nodeName==="#text"&&c.childNodes[0].value===map.text){const t=c.childNodes[0];t.parentNode=n;domMaps.set(t,map);return[t];}return[c];
    });
    const merged:HtmlNode[]=[];for(const c of n.childNodes){const p=merged.at(-1);if(p?.nodeName==="#text"&&c.nodeName==="#text"){
      const pm=domMaps.get(p),cm=domMaps.get(c);if(pm&&cm&&pm.uri===cm.uri){const shift=p.value.length;pm.text+=cm.text;pm.runs.push(...cm.runs.map(r=>({...r,generatedStart:r.generatedStart+shift,generatedEnd:r.generatedEnd+shift})));pm.runs=compact(pm.runs);p.value+=c.value;continue;}
      if(pm&&!cm){pm.text+=c.value;p.value+=c.value;continue;}
      if(!pm&&cm){const shift=p.value.length;cm.runs=cm.runs.map(r=>({...r,generatedStart:r.generatedStart+shift,generatedEnd:r.generatedEnd+shift}));cm.text=p.value+c.value;domMaps.set(p,cm);p.value+=c.value;continue;}
      if(!pm&&!cm){p.value+=c.value;continue;}
    }merged.push(c);}n.childNodes=merged;
  };clean(document);
  const sourceMap:CompiledDocument["sourceMap"]=[],mappings:TextMapping[]=[];
  const htmlElement=document.childNodes.find((n:any)=>n.nodeName==="html")!;
  const collect=(n:HtmlNode,path:number[])=>{const map=domMaps.get(n);if(map){sourceMap.push({path,key:map.key,text:n.value,kind:map.kind});mappings.push(map);}n.childNodes?.forEach((c:HtmlNode,i:number)=>collect(c,[...path,i]));};collect(htmlElement,[]);
  const result=immutable({work:snapshot.work,epoch:snapshot.epoch,revision:snapshot.revision,html:serialize(document),css:createPublicationCss({settings:snapshot.settings})+'\np { white-space: pre-wrap; }\n',sourceMap,mappings,headings,diagnostics,resourceRequests:resources,resourceDiscovery:discoverHtmlResources(document,snapshot.work)});
  timing("html-normalization-sidecar-freeze");return result;
}
