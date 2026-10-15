import {test} from "node:test";
import assert from "node:assert/strict";
import {calculateLayoutGeometry} from "../src/config/layout-geometry.js";
import {BUILTIN_PUBLICATION,publicationValues,applyPublicationValues} from "../src/config/publication-editor.js";
import {createPublicationCss} from "../src/compiler/publication-css.js";
test("custom margins warn about desired text count without changing CSS dimensions",()=>{
 const values={...publicationValues(BUILTIN_PUBLICATION),"layout.pageMargin":"10mm 12mm 10mm 8mm","layout.mirrorMargins":true,"layout.charactersPerLine":100};
 const review=calculateLayoutGeometry(values,{width:105,height:148});assert.equal(review.errors.length,0);assert(review.warnings.some(m=>m.includes("カスタム余白")));
 const css=createPublicationCss({settings:applyPublicationValues(BUILTIN_PUBLICATION,values)});assert(css.includes("@page :left { margin: 10mm 12mm 10mm 8mm; }"));assert(css.includes("@page :right { margin: 10mm 8mm 10mm 12mm; }"));
 const css2=createPublicationCss({settings:applyPublicationValues(BUILTIN_PUBLICATION,{...values,"layout.charactersPerLine":40})});assert.equal(css,css2);
});
