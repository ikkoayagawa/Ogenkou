export function manuscript(size, profile='plain', position='middle') {
  const sentence=profile==='plain'?'これは日本語の小説本文です。主人公は窓を開けた。':'これは日本語小説です。漢字《かんじ》と｜親文字《よみ》、12、か\u3099。';
  const paragraph=sentence.repeat(Math.ceil(160/sentence.length)).slice(0,160)+'\n\n';
  let text=paragraph.repeat(Math.ceil(size/paragraph.length)).slice(0,size);
  const wanted=position==='start'?0:position==='end'?Math.max(0,size-180):Math.floor(size/2);
  const start=wanted?text.lastIndexOf('\n\n',wanted)+2:0;
  const marker='編集対象の本文です。';
  text=text.slice(0,start)+marker+text.slice(start+marker.length);
  if(text.length!==size||text.indexOf(marker)!==start)throw Error('Fixture size/target mismatch');
  return {text,marker,offset:start};
}
