import {test} from "node:test";
import assert from "node:assert/strict";
import {SourceHistory,shiftOffset} from "../src/preview/source-navigation.js";
test("source rebasing follows skipped editor versions and refuses missing history",()=>{
 const h=new SourceHistory();h.record('file:///a',2,[{start:0,end:0,text:'😀'}]);h.record('file:///a',3,[{start:5,end:8,text:''}]);
 assert.equal(h.rebase('file:///a',10,1,3),9);assert.equal(h.rebase('file:///a',4,1,3),5);assert.equal(h.rebase('file:///a',3,0,3),null);
 assert.equal(h.rebase('file:///b',3,1,2),null);assert.equal(shiftOffset(5,[{start:2,end:7,text:'替'}]).approximate,true);
});
