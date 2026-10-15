const vscode = require('vscode');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const {pathToFileURL} = require('node:url');
exports.run = async () => {
  const root = process.env.OGENKOU_FOUNDATION_WORKSPACE;
  const {VSCodeWorkspace,VSCodePreferences} = await import(pathToFileURL(path.resolve(__dirname,'../dist/src/host/vscode-adapters.js')));
  const {SettingsService} = await import(pathToFileURL(path.resolve(__dirname,'../dist/src/services/settings-service.js')));
  const {SnapshotBuilder} = await import(pathToFileURL(path.resolve(__dirname,'../dist/src/services/snapshot-builder.js')));
  const {CompilerService} = await import(pathToFileURL(path.resolve(__dirname,'../dist/src/compiler/compiler-service.js')));
  const {RenderInputBuilder} = await import(pathToFileURL(path.resolve(__dirname,'../dist/src/services/render-input-builder.js')));
  const api = new VSCodeWorkspace(vscode,vscode.Uri.file(root));
  const context = await vscode.extensions.getExtension('local-tests.ogenkou-foundation-test-host').activate();
  await context.storage.update('publicationDefaults',{'layout.fontSize':'8pt'});
  const preferences = new VSCodePreferences(context.storage);
  const service = new SettingsService(api,preferences);
  const config = vscode.Uri.file(path.join(root,'ogenkou.jsonc'));
  const manuscript = vscode.Uri.file(path.join(root,'01.novel'));
  const signal = new AbortController().signal;
  const checks = [];
  try {
    const legacy = await preferences.read(signal);
    assert.equal(legacy.value.defaults['layout.fontSize'],'8pt');
    assert.equal(legacy.value.paperLayouts['vertical:A6']['layout.fontSize'],'8pt'); checks.push('legacy-default-and-preset-read');
    service.activate(root,config.toString());
    await service.initializeNew(); assert.match(await fs.readFile(config.fsPath,'utf8'),/settingsVersion/u); assert(!vscode.window.visibleTextEditors.some(e=>e.document.uri.toString()===config.toString()));checks.push('new-setting-created-without-opening-editor');
    await assert.rejects(service.initializeNew()); checks.push('create-overwrite-rejected');
    const before = await fs.readFile(config.fsPath,'utf8');
    await service.save(await service.read('project'),{'layout.fontSize':'10pt'});
    let doc = await vscode.workspace.openTextDocument(config);
    assert(doc.isDirty); assert.equal(await fs.readFile(config.fsPath,'utf8'),before); checks.push('clean-gui-apply-does-not-save');
    const stale = await service.read('project');
    const edit = new vscode.WorkspaceEdit(); edit.insert(config,new vscode.Position(0,0),'// unsaved user comment\n');
    assert(await vscode.workspace.applyEdit(edit));
    await assert.rejects(service.save(stale,{'layout.fontSize':'11pt'})); checks.push('editor-version-conflict');
    await service.save(await service.read('project'),{'layout.fontSize':'12pt'});
    assert(doc.getText().startsWith('// unsaved user comment')); assert(doc.isDirty); checks.push('dirty-gui-apply-preserves-user-edit');
    const md = await vscode.workspace.openTextDocument(manuscript);
    const change = new vscode.WorkspaceEdit(); change.insert(manuscript,new vscode.Position(0,0),'未保存😀\n');
    assert(await vscode.workspace.applyEdit(change));
    const builder = new SnapshotBuilder(api.snapshotHost()); builder.activate(manuscript.toString());
    const snapshot = await builder.build(); assert(snapshot.sources[0].text.startsWith('未保存😀'));
    assert.equal(snapshot.rawSettings.layout.fontSize,'12pt'); checks.push('snapshot-uses-unsaved-manuscript-and-setting');
    const compiler = new CompilerService();
    try { const compiled = await compiler.compile(snapshot); assert(compiled.html.includes('未保存😀')); assert.equal(compiled.revision,snapshot.revision); assert(compiled.sourceMap.length>0); checks.push('vfm-worker-in-extension-host'); }
    finally { await compiler.close(); }
    await md.save(); const saved = await builder.build(); assert.equal(saved.revision,snapshot.revision); checks.push('same-content-save-does-not-increment');
    await fs.writeFile(path.join(root,'host.css'),'@import "imported.css";');
    await fs.writeFile(path.join(root,'imported.css'),'p {color:red}');
    const cssUri=vscode.Uri.file(path.join(root,'imported.css'));
    const cssDoc=await vscode.workspace.openTextDocument(cssUri);
    const resourceEdit=new vscode.WorkspaceEdit();
    resourceEdit.replace(cssUri,new vscode.Range(cssDoc.positionAt(0),cssDoc.positionAt(cssDoc.getText().length)),'p {color:blue}');
    resourceEdit.insert(config,doc.positionAt(doc.getText().indexOf('{')+1),'"style":"host.css",');
    assert(await vscode.workspace.applyEdit(resourceEdit));
    const resourceCompiler=new CompilerService();
    try {
      const input=await new RenderInputBuilder(builder,resourceCompiler).build();
      assert(input.snapshot.resourceManifestComplete);
      const imported=input.snapshot.resources.find(r=>r.uri.endsWith('/imported.css'));
      assert.equal(Buffer.from(imported.base64,'base64').toString(),'p {color:blue}');
      assert.equal(await fs.readFile(cssUri.fsPath,'utf8'),'p {color:red}');
      assert.equal(input.document.revision,input.snapshot.revision);
      checks.push('resource-collector-uses-unsaved-imported-css');
    } finally {await resourceCompiler.close();}
    const base = await preferences.read(signal);
    await preferences.compareAndSwap(base,base.value,signal);
    assert.equal(context.storage.get('publicationDefaults')['layout.fontSize'],'8pt');
    await assert.rejects(preferences.compareAndSwap(base,base.value,signal)); checks.push('preferences-stale-write-rejected');
    service.close(); builder.close(); api.dispose(); await assert.rejects(api.read(config.toString(),signal)); checks.push('disposed-adapter-rejects');
    await fs.writeFile(process.env.OGENKOU_FOUNDATION_RESULT,JSON.stringify({vscode:vscode.version,checks,passed:checks.length},null,2));
  } finally { api.dispose(); }
};
