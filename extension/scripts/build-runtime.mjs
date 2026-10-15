import fs from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..'),core=path.resolve(root,'../vivliostyle/packages/core');
const output=path.join(root,'dist/runtime');await fs.mkdir(output,{recursive:true});
await fs.copyFile(path.join(core,'lib/vivliostyle.iife.js'),path.join(output,'core.js'));
// Core embeds the user-agent CSS. No external resources directory is required.
await fs.mkdir(path.join(output,'resources'),{recursive:true});
await fs.copyFile(path.join(root,'src/preview/browser.mjs'),path.join(output,'browser.mjs'));
await fs.copyFile(path.join(root,'src/preview/ui.mjs'),path.join(output,'ui.mjs'));
for(const name of ['layout-geometry','paper-size','page-margin'])await fs.copyFile(path.join(root,'dist/src/config',name+'.js'),path.join(output,name+'.js'));
