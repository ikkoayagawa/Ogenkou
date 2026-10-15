export const css=`@-epubx-viewport{width:105mm;height:148mm}
@page{size:105mm 148mm;margin:10.5mm 8.05mm}
html{writing-mode:vertical-rl;font:9pt "Yu Mincho","YuMincho",serif;line-height:1.75}
body,p{margin:0;padding:0}`;

export function fixture(size,position='middle'){
  const prose='　薄い雲の向こうから朝の光が差した。机の上には昨日の手紙がある。窓を開け、庭の葉が揺れる音を聞いた。';
  const text=prose.repeat(Math.ceil(size/prose.length)).slice(0,size);
  const paragraphs=Array.from({length:Math.ceil(size/120)},(_,i)=>{
    const original=text.slice(i*120,(i+1)*120),label=`第${i+1}段落。`;
    return (label+original.slice(label.length)).slice(0,original.length);
  });
  const ratio={early:.25,middle:.5,late:.75}[position];
  if(ratio===undefined)throw Error('Invalid position');
  const editIndex=Math.floor(paragraphs.length*ratio);
  const html=edited=>'<!doctype html><html lang="ja"><head><meta charset="utf-8"></head><body>'+paragraphs.map((p,i)=>(edited&&i===editIndex?'<p id="inserted-blank"><span id="edit-target"></span><br></p>':'')+`<p id="p-${i}">${p}</p>`).join('')+'</body></html>';
  return {size,position,editIndex,editOffset:editIndex*120,html:html(false),editedHtml:html(true),css};
}

export async function runTrial({build,mode,fixture,timeoutMs}){
  const api=globalThis.VivliostyleCore,root=document.getElementById('root');
  const url=location.origin+'/manuscript.html';
  const make=focused=>{
    const viewport=document.createElement('div');viewport.style.cssText='width:1100px;height:850px';root.append(viewport);
    return new api.CoreViewer({viewportElement:viewport,userAgentRootURL:location.origin+'/resources/'},{autoResize:false,allowScripts:false,renderAllPages:!focused,pageViewMode:'singlePage',...(build==='current'?{paginationMode:focused?'target-display-unit':'complete'}:{})});
  };
  const wait=(viewer,type,revision)=>new Promise((resolve,reject)=>{
    const clean=()=>{clearTimeout(timer);viewer.removeListener(type,done);viewer.removeListener('error',fail)};
    const done=e=>{if(build==='current'&&e.revision!==revision)return;clean();resolve({at:performance.now(),event:{revision:e.revision,reusedPages:e.reusedPages,reusedPrefixPages:e.reusedPrefixPages,reusedSuffixPages:e.reusedSuffixPages,targetResolved:e.targetResolved,referenceCompletionRequired:e.referenceCompletionRequired}})};
    const fail=e=>{clean();reject(Error('Core error: '+String(e.content?.error??e.content??'unknown')))};
    const timer=setTimeout(()=>{clean();viewer.cancelPreviewUpdate?.();reject(Error(type+' timeout'))},timeoutMs);
    viewer.addListener(type,done);viewer.addListener('error',fail);
  });
  const source=(edited,revision)=>({url,html:edited?fixture.editedHtml:fixture.html,revision,resources:[]});
  const load=(viewer,edited,revision,extra={})=>{
    const options={authorStyleSheet:[{text:fixture.css}],...extra};
    if(build==='current')viewer.loadMemoryDocument(source(edited,revision),options);
    else viewer.loadDocument(url,{...options,documentObject:new DOMParser().parseFromString(source(edited,revision).html,'text/html')});
  };
  const snapshot=container=>{
    const display=container.style.display;container.style.display='block';
    const origin=container.getBoundingClientRect(),round=v=>Math.round(v*100)/100;
    const walker=document.createTreeWalker(container,NodeFilter.SHOW_TEXT),runs=[];
    while(walker.nextNode()){
      const node=walker.currentNode;if(!node.nodeValue)continue;
      const range=document.createRange();range.selectNodeContents(node);
      runs.push([node.nodeValue,[...range.getClientRects()].map(r=>[round(r.x-origin.x),round(r.y-origin.y),round(r.width),round(r.height)])]);
    }
    const result={text:container.textContent,width:container.offsetWidth,height:container.offsetHeight,side:container.getAttribute('data-vivliostyle-page-side'),runs};
    container.style.display=display;return result;
  };
  const allPapers=()=>[...root.querySelectorAll('[data-vivliostyle-page-container]')].sort((a,b)=>Number(a.getAttribute('data-vivliostyle-page-index'))-Number(b.getAttribute('data-vivliostyle-page-index')));
  let viewer=make(false),terminal,start,seedPrepareMs=0,baselineMs=null;
  try{
    if(mode==='initial'){
      terminal=wait(viewer,'loaded',1);start=performance.now();load(viewer,false,1);
    }else{
      const ready=wait(viewer,'loaded',1),setup=performance.now();load(viewer,false,1);await ready;
      if(build==='current')await viewer.waitForPreviewResources({complete:true});
      baselineMs=performance.now()-setup;
      if(mode==='focused'){
        const donor=viewer,seed=donor.getCommittedPreviewSnapshotSeed();viewer=make(true);
        terminal=wait(viewer,'focusedterminal',2);start=performance.now();
        const cloneStart=performance.now(),prepared=viewer.preparePreviewSnapshotSeed(seed);seedPrepareMs=performance.now()-cloneStart;
        load(viewer,true,2,{fragment:'#edit-target',previewSnapshotSeed:prepared,reusePages:true,focusedDisplayMode:'singlePage'});
      }else{
        terminal=wait(viewer,'loaded',2);start=performance.now();
        if(build==='current'){
          viewer.setOptions({renderAllPages:false,paginationMode:'complete'});
          viewer.refreshMemoryDocument(source(true,2),{fragment:'#edit-target',reusePages:true});
        }else load(viewer,true,2,{fragment:'#edit-target'});
      }
    }
    const done=await terminal,durationMs=done.at-start;
    await document.fonts.ready;
    let papers,targetIndex=null,retainMs=null;
    if(mode==='focused'){
      if(!done.event.targetResolved)throw Error('Focused target unresolved');
      if(done.event.referenceCompletionRequired)throw Error('Plain fixture unexpectedly required full layout');
      const unit=viewer.getCurrentPreviewDisplayUnit();targetIndex=unit.epage;
      if(unit.containers.length!==1||!unit.containers[0].querySelector('[id="edit-target"], [id$="edit-target"]'))throw Error('Focused paper does not contain inserted line');
      const retainStart=performance.now(),handle=await viewer.retainPreviewDisplayUnitAsync();retainMs=performance.now()-retainStart;
      papers=unit.containers.map(snapshot);handle.release();
    }else{
      if(build==='current')await viewer.waitForPreviewResources({complete:true});
      const committedCount=build==='current'?viewer.exportCompletedPaper('upstream-benchmark').pages.length:viewer.getPageSizes().length;
      const containers=build==='current'?Array.from({length:committedCount},(_,i)=>viewer.getLatestCommittedPageContainerForEpage(i)):allPapers();papers=containers.map(snapshot);
      if(mode!=='initial'){
        targetIndex=containers.findIndex(c=>!!c.querySelector('[id="edit-target"], [id$="edit-target"]'));
        if(targetIndex<0)throw Error('Full render omitted inserted line');
      }
      if(papers.length!==committedCount)throw Error('Incomplete full render '+JSON.stringify({build,mode,dom:papers.length,sizes:viewer.getPageSizes().length,indices:containers.map(c=>c.getAttribute('data-vivliostyle-page-index'))}));
      if(papers.map(p=>p.text).join('')!==new DOMParser().parseFromString(mode==='initial'?fixture.html:fixture.editedHtml,'text/html').body.textContent)throw Error('Full render omitted source text');
    }
    return {durationMs,seedPrepareMs,retainMs,baselineMs,targetIndex,pageCount:mode==='focused'?null:papers.length,terminal:done.event,papers};
  }finally{viewer.disposeMemoryResources?.();}
}
