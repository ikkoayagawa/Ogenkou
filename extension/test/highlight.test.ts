import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {EventEmitter} from 'node:events';
import ts from 'typescript';

test('editing retains highlights, ignores stale work, and replaces ranges without recreating decorations',()=>{
  const timers=new Map<number,()=>void>();let timerId=0,created=0,disposed=0,applied=0;
  const listeners:Record<string,Function>={};
  const document={languageId:'novel',version:1,getText:()=> '本文',positionAt:(n:number)=>n};
  const editor={document,setDecorations:()=>{applied++;}};
  let enabled=true;
  const subscribe=(name:string)=>(fn:Function)=>{listeners[name]=fn;return {dispose(){}};};
  const vscode={
    StatusBarAlignment:{Left:0},Range:class {constructor(public start:number,public end:number){}},
    window:{activeTextEditor:editor,createStatusBarItem:()=>({hide(){},dispose(){}}),
      createTextEditorDecorationType:()=>{created++;return {dispose(){disposed++;}};},
      onDidChangeActiveTextEditor:subscribe('active')},
    workspace:{onDidChangeTextDocument:subscribe('edit'),onDidChangeConfiguration:subscribe('config'),
      getConfiguration:()=>({get:(key:string,fallback:unknown)=>key==='highlight.rules'?[{pattern:'本文',color:'red'}]:key==='highlight.enabled'?enabled:fallback})},
  };
  const workers:FakeWorker[]=[];
  class FakeWorker extends EventEmitter {terminated=false;constructor(..._args:unknown[]){super();workers.push(this);}terminate(){this.terminated=true;return Promise.resolve(0);}}
  const source=fs.readFileSync(new URL('../../src/host/editor-support.ts',import.meta.url),'utf8').replaceAll('import.meta.url',JSON.stringify('file:///highlight-test/editor-support.js'));
  const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const exports:Record<string,Function>={};
  const context={subscriptions:[] as {dispose():void}[]};
  vm.runInNewContext(code,{exports,URL,TextDecoder,
    require:(name:string)=>name==='vscode'?vscode:name==='node:worker_threads'?{Worker:FakeWorker}:name.includes('snapshot-builder')?{naturalCompare:()=>0}:name==='node:child_process'?{execFile:()=>{}}:name==='node:util'?{promisify:()=>()=>{}}:{},
    setTimeout:(fn:()=>void)=>{const id=++timerId;timers.set(id,fn);return id;},clearTimeout:(id:number)=>timers.delete(id)});
  exports.registerEditorSupport!(context);
  // The first timer updates the status bar; execute only the highlight debounce.
  const runHighlight=()=>{const id=Math.max(...timers.keys());const fn=timers.get(id)!;timers.delete(id);fn();};
  const complete=(worker:FakeWorker)=>worker.emit('message',[{ranges:[{start:0,end:2}]}]);
  runHighlight();complete(workers[0]!);assert.equal(created,1);assert.equal(applied,1);
  document.version++;listeners.edit!({document});
  assert.equal(disposed,0,'existing decoration must survive the edit debounce');
  runHighlight();const stale=workers[1]!;
  document.version++;listeners.edit!({document});assert.equal(stale.terminated,true);
  complete(stale);assert.equal(applied,1,'stale results must not repaint');
  runHighlight();complete(workers[2]!);
  assert.equal(created,1,'reuse the same decoration type');assert.equal(applied,2);assert.equal(disposed,0);
  listeners.edit!({document:{}});assert.equal(workers.length,3,'unrelated documents must not restart highlighting');
  document.version++;listeners.edit!({document});runHighlight();
  // Worker failure leaves the last valid highlights visible.
  workers[3]!.emit('error',new Error('worker failed'));assert.equal(disposed,0);
  document.version++;listeners.edit!({document});runHighlight();runHighlight();
  assert.equal(workers[4]!.terminated,true,'time budget still terminates a stalled worker');assert.equal(disposed,0);
  enabled=false;listeners.config!({affectsConfiguration:()=>true});assert.equal(disposed,1,'disabling highlighting clears it');
  context.subscriptions.forEach(s=>s.dispose());
});
