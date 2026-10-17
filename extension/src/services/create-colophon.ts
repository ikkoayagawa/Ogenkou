import {applyEdits,modify} from 'jsonc-parser';
import {parseProjectConfig} from '../project/project-config.js';
import {COLOPHON_FILENAME,COLOPHON_STYLESHEET,COLOPHON_CSS,colophonTemplate} from '../compiler/colophon.js';
import type {DocumentStore,TextRecord} from './contracts.js';

const missing=(error:unknown)=>['ENOENT','ENOTDIR','FileNotFound'].includes((error as {code?:string}).code??'');
async function optional(store:DocumentStore,uri:string,signal:AbortSignal){try{return await store.read(uri,signal);}catch(error){signal.throwIfAborted();if(missing(error))return undefined;throw error;}}
async function create(store:DocumentStore,uri:string,text:string,signal:AbortSignal){try{return await store.create(uri,text,signal);}catch(error){if(['EEXIST','FileExists'].includes((error as {code?:string}).code??'')){const existing=await optional(store,uri,signal);if(existing)return existing;}throw error;}}

/** Existing manuscripts/styles are never replaced; config edits preserve dirty buffers. */
export async function createColophon(store:DocumentStore,root:string,mkdir:(uri:string)=>Promise<void>,signal:AbortSignal,date?:Date):Promise<{document:TextRecord;config?:TextRecord;saveConfig:boolean}> {
  const uri=new URL(COLOPHON_FILENAME,root).href;
  const existing=await optional(store,uri,signal);
  if(existing)return {document:existing,saveConfig:false};
  const base=await store.read(new URL('ogenkou.jsonc',root).href,signal),config=parseProjectConfig(base.text);
  const cssUri=new URL(COLOPHON_STYLESHEET,root).href;
  if(!await optional(store,cssUri,signal)){
    signal.throwIfAborted();await mkdir(new URL('styles/',root).href);signal.throwIfAborted();
    await create(store,cssUri,'/* 奥付の見た目を変更するには .colophon 以下を編集してください。 */\n'+COLOPHON_CSS,signal);
  }
  let changed:TextRecord|undefined;
  if(![...config.theme,config.style,config.userStyle].some(value=>value&&new URL(value,root).href===cssUri)){
    const text=applyEdits(base.text,modify(base.text,['theme'],[...config.theme,COLOPHON_STYLESHEET],{formattingOptions:{insertSpaces:true,tabSize:2,eol:base.text.includes('\r\n')?'\r\n':'\n'}}));
    changed=await store.compareAndSwap(base,text,signal);
  }
  signal.throwIfAborted();
  return {document:await create(store,uri,colophonTemplate(config.title??'',config.author??'',date),signal),config:changed,saveConfig:!base.dirty};
}
