import {parentPort,workerData} from "node:worker_threads";
const {text,rules}=workerData as {text:string;rules:{pattern:string;flags?:string}[]};
const matches=rules.map(rule=>{
  try{const regex=new RegExp(rule.pattern,[...new Set((rule.flags??'u')+'g')].join('')),ranges:{start:number;end:number}[]=[];
    let match:RegExpExecArray|null;while(ranges.length<2000&&(match=regex.exec(text))){ranges.push({start:match.index,end:match.index+match[0].length});if(!match[0].length)regex.lastIndex++;}return {ranges};
  }catch(error){return {ranges:[],error:String(error)};}
});parentPort!.postMessage(matches);
