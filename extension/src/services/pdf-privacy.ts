import {PDFArray,PDFDict,PDFDocument,PDFHexString,PDFName,PDFObject,PDFRef,PDFStream,PDFString} from "pdf-lib";
import {isIP} from "node:net";

/** Only intentional public web/contact links survive a distribution PDF. */
export function isPublicPdfLink(value:string):boolean {
  let url:URL;try{url=new URL(value);}catch{return false;}
  if(url.protocol==="mailto:"||url.protocol==="tel:")return true;
  if(url.protocol!=="https:"&&url.protocol!=="http:")return false;
  if(url.username||url.password)return false;
  const host=url.hostname.toLowerCase().replace(/\.$/,"").replace(/^\[|\]$/g,"");
  if(host==="localhost"||/\.(?:localhost|local|invalid)$/.test(host))return false;
  if(isIP(host)===4){const [a=0,b=0]=host.split(".").map(Number);return !(a===0||a===10||a===127||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&b===168));}
  if(isIP(host)===6)return !(host==="::"||host==="::1"||/^(?:f[cd]|fe[89ab]|::ffff:)/.test(host));
  return host.includes(".");
}

/** Rewrite the complete generated PDF; old metadata must not remain in orphan objects. */
export async function sanitizeGeneratedPdf(bytes:Uint8Array):Promise<Uint8Array> {
  const pdf=await PDFDocument.load(bytes,{updateMetadata:false,throwOnInvalidObject:true});
  const context=pdf.context,dicts=new Set<PDFDict>();
  const visit=(object:PDFObject):void=>{
    if(object instanceof PDFDict){if(dicts.has(object))return;dicts.add(object);for(const [,value]of object.entries())visit(value);}
    else if(object instanceof PDFArray)for(let i=0;i<object.size();i++)visit(object.get(i));
    else if(object instanceof PDFStream)visit(object.dict);
  };
  for(const [,object]of context.enumerateIndirectObjects())visit(object);
  const obsolete=new Set<PDFRef>();
  const info=context.trailerInfo.Info;
  context.trailerInfo.Info=undefined;context.trailerInfo.ID=undefined;
  if(info instanceof PDFRef)obsolete.add(info);
  const unsafeActions=new Set<PDFDict>();
  for(const dict of dicts){
    const metadata=dict.get(PDFName.of("Metadata"));
    dict.delete(PDFName.of("Metadata"));
    if(metadata instanceof PDFRef)obsolete.add(metadata);
    const uriRef=dict.get(PDFName.of("URI")),uri=context.lookup(uriRef);
    if((uri instanceof PDFString||uri instanceof PDFHexString)&&!isPublicPdfLink(uri.decodeText())){
      unsafeActions.add(dict);dict.delete(PDFName.of("URI"));dict.delete(PDFName.of("S"));
      // A URI may itself be an indirect string. Remove its obsolete bytes too.
      if(uriRef instanceof PDFRef)obsolete.add(uriRef);
    }
  }
  for(const dict of dicts){const action=context.lookup(dict.get(PDFName.of("A")));if(action instanceof PDFDict&&unsafeActions.has(action))dict.delete(PDFName.of("A"));}
  for(const ref of obsolete)context.delete(ref);
  return pdf.save({useObjectStreams:false,addDefaultPage:false,updateFieldAppearances:false});
}
