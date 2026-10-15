import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

const root=path.resolve(import.meta.dirname,'..');
const args=Object.fromEntries(process.argv.slice(2).map(arg=>{const i=arg.indexOf('=');return i<0?[arg.slice(2),true]:[arg.slice(2,i),arg.slice(i+1)]}));
const target=path.resolve(args.target??path.join(root,'.recovery','publication-export'));
if(target===root||root.startsWith(target+path.sep)||target.startsWith(path.join(root,'.git')+path.sep))throw Error('Unsafe publication target');
const manifest=JSON.parse(await fs.readFile(path.join(root,'publication.json'),'utf8'));
const files=[];
async function collect(relative){
  if(manifest.exclude?.includes(relative))return;
  const full=path.resolve(root,relative);
  if(!full.startsWith(root+path.sep))throw Error('Source outside repository');
  const info=await fs.lstat(full);
  if(info.isSymbolicLink())throw Error('Symbolic links need explicit review: '+relative);
  if(info.isDirectory()){
    for(const name of (await fs.readdir(full)).sort()){
      if(['.git','node_modules','dist','artifacts'].includes(name))continue;
      await collect(relative+'/'+name);
    }
  }else files.push(relative);
}
for(const entry of manifest.include)await collect(entry);
if(new Set(files).size!==files.length)throw Error('Duplicate publication files');
const forbidden=/(?:[A-Z]:[\\/]+Users[\\/]+[^\\/\s"']+|\/Users\/[^/\s"']+|\/home\/[^/\s"']+)/i;
for(const file of files){const bytes=await fs.readFile(path.join(root,file));if(!bytes.includes(0)&&forbidden.test(bytes.toString('utf8')))throw Error('Personal path or unfinished note: '+file);}
const git=(...a)=>execFileSync('git',a,{cwd:root,encoding:'utf8'}).trim();
const revision=git('-C',manifest.core.path,'rev-parse','HEAD');
const recorded=JSON.parse(await fs.readFile(path.join(root,'core-revision.json'),'utf8'));
if(revision!==manifest.core.revision||recorded.revision!==revision)throw Error('Core revisions disagree');
if(git('-C',manifest.core.path,'status','--porcelain'))throw Error('Core must be committed before export');
console.log(JSON.stringify({files:files.length,core:revision,target,mode:args.write?'write':'preview'},null,2));
if(!args.write)process.exit(0);
try {if((await fs.readdir(target)).length)throw Error('Target must be empty. Export to a fresh directory and review its diff before updating an existing publication.');}catch(e){if(e.code!=='ENOENT')throw e;}
await fs.mkdir(target,{recursive:true});
for(const relative of files){const dest=path.join(target,relative);await fs.mkdir(path.dirname(dest),{recursive:true});await fs.copyFile(path.join(root,relative),dest);}
await fs.writeFile(path.join(target,'.gitignore'),'/.recovery/\n/extension/dist/\n/extension/artifacts/\nnode_modules/\n*.log\n.env\n.env.*\n');
