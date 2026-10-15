export function previewMarkup(nonce:string,csp:string,origin:string,base:string,script:string) {
return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}' ${csp} ${origin}; connect-src ${origin} blob: data:; frame-src ${origin} 'self' blob:; style-src 'unsafe-inline' blob: data: ${origin}; img-src blob: data:; font-src blob: data: ${origin};"><style>*{box-sizing:border-box}html{height:100%;overflow:hidden}body{height:100%;--toolbar-height:3rem;--seek-height:2rem;margin:0;font:13px var(--vscode-font-family);overflow:hidden;color:var(--vscode-foreground)}#cw{position:absolute;top:var(--toolbar-height);width:1100px;height:850px;border:0;z-index:0}#papers{position:absolute;inset:var(--toolbar-height) 0 var(--seek-height);z-index:1;overflow:auto;scrollbar-width:none;background:#35383d}.paper{position:absolute;transform-origin:top left}#outline button{display:block;border:0}#status{font-size:.7rem;white-space:nowrap;inline-size:10em;max-inline-size:10em;overflow:hidden;text-overflow:ellipsis}#total{display:inline-block;inline-size:8ch;font-variant-numeric:tabular-nums}#mode{display:none}.settings-pair{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:0 .65rem}.settings-pair .reset{grid-column:1 / -1;justify-self:start}.paper-dimensions label,.margin-dimensions label{font-size:.8rem}.settings-row small{grid-column:1 / -1;display:block;font-size:.8rem;line-height:1.5;opacity:.85}.settings-heading button{padding:.25rem .6rem}.settings-actions{z-index:1}#settings-geometry{font-size:.8rem}#settings-message{white-space:pre-wrap}#settings-dirty-help{font-size:.8rem}#settings-fields:disabled{opacity:.6}.control-separator{flex-shrink:0}#toolbar > *{flex-shrink:0}#settings-review{padding:.4rem 0}#settings-review:empty{display:none}    #preview-controls { position: absolute; z-index: 5; inset: 0 0 auto; box-sizing: border-box; height: var(--toolbar-height); display: flex; align-items: center; justify-content: center; gap: .35rem; padding: .35rem .5rem; overflow-x: auto; color: #f3f3f3; background: #25272a; border-bottom: 1px solid #ffffff20; }
    #preview-controls { overflow: hidden; }
    #papers::-webkit-scrollbar, #toolbar::-webkit-scrollbar { display:none; }
    #toolbar { scrollbar-width:none; }
    #outline-toggle, #settings-toggle { flex-shrink: 0; }
    #toolbar { display: flex; flex: 1; min-width: 0; align-items: center; justify-content: safe center; gap: .35rem; overflow-x: auto; }
    #toolbar > * { flex-shrink: 0; }
    #page-navigation, #zoom-controls, #spread-controls { display: flex; align-items: center; gap: .25rem; }
    #page-navigation[data-progression="rtl"] #first { order: 5; }
#page-navigation[data-progression="rtl"] #previous { order: 4; }
    #page-navigation[data-progression="rtl"] #page-position { order: 3; }
    #page-navigation[data-progression="rtl"] #layout-progress { order: 3; }
    #page-navigation[data-progression="rtl"] #next { order: 2; }
#page-navigation[data-progression="rtl"] #last { order: 1; }
    #page-position { display: flex; align-items: center; gap: .25rem; white-space: nowrap; font-variant-numeric: tabular-nums; }
    #page { box-sizing: border-box; width: 3.5em; padding: .2rem .3rem; border: 1px solid var(--vscode-input-border, #ffffff30); border-radius: .2rem; color: var(--vscode-input-foreground); background: var(--vscode-input-background); text-align: end; }
    #total { display: inline-block; box-sizing: border-box; inline-size: 8ch; text-align: start; }
    #layout-progress { --progress: 0; position: relative; display: inline-grid; place-items: center; box-sizing: border-box; width: 2rem; height: 2rem; margin-inline-start: .15rem; border-radius: 50%; background: conic-gradient(var(--vscode-progressBar-background, #2f81f7) calc(var(--progress) * 1turn), #ffffff24 0); color: #f7f7f7; font-size: .58rem; font-weight: 700; line-height: 1; font-variant-numeric: tabular-nums; }
    #layout-progress::before { content: ""; position: absolute; inset: 3px; border-radius: inherit; background: #25272a; }
    #layout-progress > span { position: relative; z-index: 1; }
    #layout-progress[hidden] { display: inline-grid; visibility: hidden; }
    #presentation-state { box-sizing: border-box; inline-size: 12em; margin-inline-start: .35rem; padding: .22rem .45rem; border: 1px solid currentColor; border-radius: 999px; font-size: .66rem; font-weight: 700; line-height: 1; letter-spacing: .04em; text-align: center; white-space: nowrap; }
    #presentation-state[data-presentation="committed"] { color: #8bd49c; background: #21452a; }
    #presentation-state[data-presentation="working"] { color: #ffd37a; background: #543d12; }
    #presentation-state[data-presentation="speculative"] { color: #c9a7ff; background: #432a68; }
    #pipeline-state { display: flex; align-items: center; gap: .2rem; margin-inline-start: .2rem; font: 600 .6rem/1 var(--vscode-font-family); font-variant-numeric: tabular-nums; white-space: nowrap; }
    body[data-layout-diagnostics="false"] #presentation-state,
    body[data-layout-diagnostics="false"] #pipeline-state { display: none; }
    .pipeline-lane { min-width: 7.2em; padding: .22rem .35rem; border: 1px solid #ffffff28; border-radius: .25rem; color: #c9c9c9; background: #1d1f21; text-align: center; }
    .pipeline-lane[data-phase="RUNNING"] { color: #ffd37a; border-color: #ffd37a80; }
    .pipeline-lane[data-phase="READY"] { color: #9cc9ff; border-color: #9cc9ff80; }
    .pipeline-lane[data-phase="FRONT"] { color: #d3b7ff; border-color: #c9a7ff; background: #432a68; }
    .pipeline-lane[data-phase="DONE"] { color: #8bd49c; border-color: #8bd49c70; }
    .pipeline-lane[data-phase="ERROR"], .pipeline-lane[data-phase="REJECTED"] { color: #ff9d9d; border-color: #ff9d9d80; }
    .pipeline-lane[data-phase="CANCELED"] { opacity: .62; }
    #preview-controls button { min-width: 2rem; padding: .25rem .42rem; border-radius: .2rem; font-size: .9rem; line-height: 1.2; }
    #preview-controls button[aria-pressed="true"] { outline: 2px solid var(--vscode-focusBorder); outline-offset: -2px; }
    #preview-controls button:focus-visible, #page:focus-visible, #seek:focus-visible { outline: 2px solid var(--vscode-focusBorder); outline-offset: 2px; }
    #preview-controls button:disabled, #page:disabled { cursor: default; opacity: .45; }
    #outline { position: absolute; z-index: 6; inset: var(--toolbar-height) auto var(--seek-height) 0; box-sizing: border-box; width: min(22rem, 75vw); overflow: auto; padding: .5rem; color: var(--vscode-menu-foreground); background: var(--vscode-menu-background, #25272a); border-right: 1px solid #ffffff20; box-shadow: .3rem 0 1rem #0005; }
    #outline[hidden] { display: none; }
    #outline ol { margin: 0; padding: 0; list-style: none; }
    #outline button { width: 100%; padding: .35rem .5rem; color: inherit; background: transparent; text-align: start; }
    #outline button:hover { background: var(--vscode-list-hoverBackground); }
    #outline li[data-level="2"] { padding-inline-start: 1rem; }
    #outline li[data-level="3"] { padding-inline-start: 2rem; }
    #seek-container { position: absolute; z-index: 5; inset: auto 0 0; box-sizing: border-box; height: var(--seek-height); display: flex; align-items: center; padding: 0 .75rem; background: #25272a; border-top: 1px solid #ffffff20; }
    #seek { width: 100%; accent-color: var(--vscode-focusBorder); }
    #seek[dir="rtl"] { direction: rtl; }
    .control-separator { width: 1px; height: 1.4rem; margin: 0 .15rem; background: #ffffff25; }
    button { color: var(--vscode-button-foreground); background: var(--vscode-button-background); border: 0; padding: .5rem .8rem; cursor: pointer; }
    button:hover { background: var(--vscode-button-hoverBackground); }

    #settings-toggle { position: sticky; right: 0; margin-inline-start: auto; flex-shrink: 0; }
    #settings { position: absolute; z-index: 7; inset: var(--toolbar-height) 0 0 auto; box-sizing: border-box; width: min(26rem, 100%); padding: .75rem; overflow-x: hidden; overflow-y: auto; scrollbar-gutter: stable; background: var(--vscode-editor-background); color: var(--vscode-foreground); box-shadow: -.3rem 0 1rem #0006; animation: settings-slide .16s ease-out; }
    #settings[hidden] { display: none; }
    @keyframes settings-slide { from { transform: translateX(100%); } to { transform: translateX(0); } }
    .settings-heading { display: flex; align-items: center; justify-content: space-between; }
    .settings-heading h2 { margin: 0 0 .35rem; font-size: 1.15rem; }
    #settings-location { margin: .35rem 0; overflow-wrap: anywhere; font-size: .8rem; opacity: .8; }
    #settings-help { margin: .4rem 0; font-size: .8rem; line-height: 1.4; }
    #settings-fields { margin: 0; padding: 0; border: 0; min-width: 0; }
    .settings-section { margin: .8rem 0 .3rem; padding-top: .5rem; border-top: 1px solid var(--vscode-panel-border, #ffffff30); font-size: 1rem; }
    .settings-section:first-child { border-top: 0; margin-top: .5rem; }
    .paper-dimensions { grid-column: 1 / -1; display: flex; gap: .6rem; }
    .paper-dimensions[hidden] { display: none; }
    .paper-dimensions label { flex: 1; min-width: 0; }
    .paper-dimensions input { width: 100%; margin-top: .3rem; }
    #settings-dirty-help { margin: .35rem 0; line-height: 1.4; }
    .margin-dimensions { grid-column: 1 / -1; display: grid; grid-template-columns: 1fr 1fr; gap: .35rem .6rem; }
    .margin-dimensions[hidden] { display: none; }
    .margin-dimensions label { min-width: 0; }
    .margin-dimensions input { width: 100%; margin-top: .2rem; }
    .settings-info { cursor: help; border-bottom: 1px dotted currentColor; }
    .settings-row[data-checkbox="true"] label { grid-column: 1; grid-row: 1; padding-inline-start: 1.6rem; align-self: center; }
    .settings-row[data-checkbox="true"] input { grid-column: 1; grid-row: 1; align-self: center; }
    .settings-row[data-checkbox="true"] button { grid-column: 2; grid-row: 1; }
    .paper-size-help { grid-column: 1 / -1; font-size: .8rem; opacity: .8; }
    .settings-row { display: grid; grid-template-columns: 1fr auto; gap: .2rem; margin-block: .55rem; }
    .settings-row > label { grid-column: 1 / -1; }
    .settings-row input, .settings-row select, #settings-target { box-sizing: border-box; min-width: 0; padding: .3rem; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, #888); }
    .settings-row input[type="checkbox"] { justify-self: start; width: 1.2rem; height: 1.2rem; }
    .settings-row button { font-size: .75rem; padding: .3rem .45rem; }
    .settings-actions { display: flex; gap: .5rem; position: sticky; bottom: 0; padding: .45rem 0; background: var(--vscode-editor-background); }
    #settings-message[data-error="true"], #settings-review[data-error="true"], #settings-review[data-warning="true"] { color: var(--vscode-errorForeground); }
    #settings button:disabled, #settings input:disabled { opacity: .5; cursor: default; }
    .settings-row[hidden] { display: none; }
    .settings-tabs { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: .25rem; margin: .6rem 0; }
    .settings-tabs [role="tab"] { padding: .25rem .25rem; line-height: 1.3; color: inherit; background: transparent; border: 1px solid var(--vscode-panel-border, #ffffff30); font-size: .9rem; }
    .settings-tabs [aria-selected="true"] { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border-color: var(--vscode-focusBorder); }
    .settings-tabs [role="tab"]:focus-visible { outline: 2px solid var(--vscode-focusBorder); outline-offset: -2px; }
    .settings-group { margin-top: .5rem; }
    .settings-group[hidden] { display: none; }
    #settings-review { white-space: pre-line; line-height: 1.4; }
    .settings-advanced { margin-top: .8rem; border-top: 1px solid var(--vscode-panel-border, #ffffff30); padding-top: .5rem; }
    .settings-advanced summary { cursor: pointer; font-weight: bold; }
</style></head><body><header id="preview-controls" aria-label="プレビュー制御"><button id="outline-toggle" title="見出し一覧" aria-label="見出し一覧を表示" aria-expanded="false">☰</button><div id="toolbar"><span class="control-separator" aria-hidden="true"></span><nav id="page-navigation" aria-label="ページ送り" data-progression="rtl"><button disabled id="first" title="先頭のページ" aria-label="先頭のページ">⇤</button><button disabled id="previous" title="前のページ" aria-label="前のページ">›</button><span id="page-position"><input id="page" type="number" min="1" value="1" aria-label="現在ページ番号"><span id="total" aria-label="総ページ数">/ —</span></span><output id="layout-progress" role="progressbar" aria-label="初期組版の進捗" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span id="layout-progress-value">0%</span></output><button disabled id="next" title="次のページ" aria-label="次のページ">‹</button><button disabled id="last" title="末尾のページ" aria-label="末尾のページ">⇥</button></nav><span class="control-separator" aria-hidden="true"></span><span id="zoom-controls" aria-label="表示倍率"><button id="zoom-out" aria-label="縮小" title="縮小">−</button><button id="zoom" title="原寸へ戻す" aria-label="原寸へ戻す">1:1</button><button id="zoom-in" aria-label="拡大" title="拡大">＋</button><button id="fit" title="紙面全体にフィット" aria-label="紙面全体にフィット">Fit</button></span><span class="control-separator" aria-hidden="true"></span><span id="spread-controls" aria-label="ページ表示方法"><button data-spread-mode="single" aria-label="単ページ表示" title="単ページ" aria-pressed="true">▯</button><button data-spread-mode="spread" aria-label="見開き表示" title="見開き" aria-pressed="false">▯▯</button><button data-spread-mode="auto" aria-label="自動表示" title="自動" aria-pressed="false">A</button><select id="mode" aria-hidden="true" tabindex="-1"><option value="single">単ページ</option><option value="spread">見開き</option><option value="auto">自動</option></select></span><span class="control-separator" aria-hidden="true"></span><button disabled id="pdf" aria-label="この作品のPDFを書き出す" title="この作品のPDFを書き出す">PDF</button><button disabled id="refresh" title="プレビューを更新">更新</button><span id="status" role="status">準備中</span></div><button id="settings-toggle" title="組版設定" aria-label="組版設定を表示" aria-expanded="false">☰</button></header><aside id="outline" hidden aria-label="見出し一覧"></aside><aside id="settings" hidden aria-label="組版設定"><div class="settings-heading"><h2>組版設定</h2><button id="settings-close" aria-label="設定を閉じる">×</button></div><label>編集対象 <select id="settings-target"><option value="project">この作品</option><option value="defaults">デフォルト</option></select></label><p id="settings-dirty-help" hidden>未適用の変更があります。編集対象を切り替えるには、変更を適用するか、未適用の変更を破棄してください。</p><p id="settings-location"></p><p id="settings-help">変更後に「適用」を押してください。</p><div id="settings-fields"></div><div class="settings-actions"><button disabled id="settings-apply">適用</button><button id="settings-discard" hidden>未適用の変更を破棄</button><button disabled id="settings-freeze" hidden>作品設定を固定化</button></div><p id="settings-message" role="status" aria-live="polite"></p></aside><iframe id="cw" title="組版処理" src="${base}cw"></iframe><main id="papers" aria-label="組版プレビュー"></main><footer id="seek-container"><input id="seek" type="range" min="1" max="1" value="1" aria-label="ページ移動"></footer><script nonce="${nonce}" src="${script}"></script><script nonce="${nonce}" type="module">import {startDisplay} from '${base}browser.mjs';const api=acquireVsCodeApi();startDisplay('${base}','${nonce}',api).catch(error=>api.postMessage({type:'failure',message:error.message}));</script></body></html>`;
}
