const {pathToFileURL}=require('node:url');
const path=require('node:path');
let runtime;
exports.activate=async context=>{
 runtime=await import(pathToFileURL(path.join(__dirname,'dist/src/extension.js')).href);
 return runtime.activate(context);
};
exports.deactivate=()=>runtime?.deactivate();
