import {test} from "node:test";
import assert from "node:assert/strict";
import {PDFDocument,PDFName,PDFString,PDFDict,PDFArray,PDFRef,PDFHexString,PDFObject} from "pdf-lib";
import {sanitizeGeneratedPdf,isPublicPdfLink} from "../src/services/pdf-privacy.js";

test("PDF privacy removes metadata bytes and private link actions while keeping pages and public links",async()=>{
 const pdf=await PDFDocument.create(),page=pdf.addPage([200,300]);page.drawText("Visible PDF content",{x:20,y:40,size:12});
 pdf.setTitle("PRIVATE_TITLE_PROBE");pdf.setAuthor("PRIVATE_AUTHOR_PROBE");pdf.setCreator("PRIVATE_SYSTEM_PROBE");pdf.setCreationDate(new Date("2026-01-01Z"));
 const ctx=pdf.context;pdf.catalog.set(PDFName.of("Metadata"),ctx.register(ctx.stream("PRIVATE_XMP_PROBE",{Type:'Metadata',Subtype:'XML'})));
 const link=(uri:string)=>ctx.register(ctx.obj({Type:'Annot',Subtype:'Link',Rect:[0,0,10,10],A:{S:'URI',URI:PDFString.of(uri)}}));
 const privateLink=link('file:///C:/private/PRIVATE_USER_PROBE/draft.txt'),publicLink=link('https://example.com/read');
 const internalLink=ctx.register(ctx.obj({Type:'Annot',Subtype:'Link',Rect:[10,10,20,20],Dest:[page.ref,'Fit']}));
 page.node.set(PDFName.of('Annots'),ctx.obj([privateLink,publicLink,internalLink]));
 const before=await pdf.save({useObjectStreams:false}),clean=await sanitizeGeneratedPdf(before),after=await PDFDocument.load(clean,{updateMetadata:false});
 assert.equal(after.getPageCount(),1);assert.deepEqual(after.getPages()[0]!.getSize(),{width:200,height:300});
 assert.equal(after.context.trailerInfo.Info,undefined);assert.equal(after.context.trailerInfo.ID,undefined);assert.equal(after.catalog.get(PDFName.of('Metadata')),undefined);
 const annots=after.getPages()[0]!.node.lookup(PDFName.of('Annots'),PDFArray);
 const local=after.context.lookup(annots.get(0),PDFDict),external=after.context.lookup(annots.get(1),PDFDict);
 const internal=after.context.lookup(annots.get(2),PDFDict);assert(internal.get(PDFName.of('Dest')) instanceof PDFArray);
 assert.equal(local.get(PDFName.of('A')),undefined);const action=external.lookup(PDFName.of('A'),PDFDict);assert.equal(action.lookup(PDFName.of('URI'),PDFString).decodeText(),'https://example.com/read');
 const decodedStrings:string[]=[];
 const walk=(o:PDFObject):void=>{
  if(o instanceof PDFString||o instanceof PDFHexString)decodedStrings.push(o.decodeText());
  else if(o instanceof PDFDict){for(const [,value]of o.entries())if(!(value instanceof PDFRef))walk(value);}
  else if(o instanceof PDFArray)for(let i=0;i<o.size();i++)walk(o.get(i));
 };
 for(const [,o]of after.context.enumerateIndirectObjects())walk(o);
 assert(!decodedStrings.some(s=>s.includes('PRIVATE_')));assert(!Buffer.from(clean).includes(Buffer.from('PRIVATE_XMP_PROBE')));
});

test("PDF link policy excludes local paths, browser internals, private network links and embedded credentials",()=>{
 for(const value of ['file:///C:/private/name/a.txt','blob:https://example.com/id','data:text/plain,a','javascript:alert(1)','notes.txt','http://localhost:99/x','http://127.1/x','http://192.168.1.1/x','http://10.1.1.1/','http://172.16.0.1/','http://[::1]/','http://[fd00::1]/','http://printer.local/','https://ogenkou.invalid/a','https://user:password@example.com/'])assert.equal(isPublicPdfLink(value),false,value);
 for(const value of ['https://example.com/a#part','http://example.org/','mailto:author@example.com','tel:+81312345678'])assert.equal(isPublicPdfLink(value),true,value);
});

test("PDF privacy fails closed on invalid PDF bytes",async()=>{await assert.rejects(sanitizeGeneratedPdf(Buffer.from('not a PDF')));});
