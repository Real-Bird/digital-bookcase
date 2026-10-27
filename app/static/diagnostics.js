async function run(){
  const output=document.getElementById('result');
  try{
    const image=new Image();image.src='/static/test-ean13.png';await image.decode();
    const cases=[
      {name:'기본 바코드',width:800,height:450,x:160,y:130,w:476,h:200},
      {name:'고해상도 영상 하단의 작은 바코드',width:1920,height:1080,x:1100,y:920,w:476,h:110},
      {name:'세로 방향 바코드',width:1280,height:720,x:650,y:100,w:476,h:150,rotate:true},
      {name:'대비가 낮은 바코드',width:1280,height:720,x:400,y:400,w:600,h:150,contrast:true},
      {name:'작은 모드 · 폭 119픽셀 바코드',width:1920,height:1080,x:900,y:510,w:119,h:50,small:true}
    ];
    let passed=0;
    for(const item of cases){
      const canvas=document.createElement('canvas');canvas.width=item.width;canvas.height=item.height;const ctx=canvas.getContext('2d');
      ctx.fillStyle='#ddd';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.save();ctx.translate(item.x,item.y);
      if(item.rotate)ctx.rotate(Math.PI/2);
      ctx.imageSmoothingEnabled=!item.small;ctx.drawImage(image,0,0,item.w,item.h);ctx.restore();
      if(item.contrast){const pixels=ctx.getImageData(0,0,canvas.width,canvas.height);for(let i=0;i<pixels.data.length;i+=4)for(let c=0;c<3;c++)pixels.data[i+c]=130+pixels.data[i+c]*.35;ctx.putImageData(pixels,0,0);}
      const decoder=new BookCamera.CameraDecoder();let result=null;
      for(let pass=0;pass<15&&!result;pass++)result=decoder.read(canvas,pass,{small:!!item.small});
      const ok=result==='9788936434267';if(ok)passed++;
      const li=document.createElement('li');li.textContent=(ok?'통과':'실패')+' · '+item.name+(result?' · '+result:'');document.getElementById('cases').append(li);
      if(!ok){const preview=document.createElement('img');preview.src=canvas.toDataURL();preview.width=400;preview.alt=item.name+' 검사 입력';li.append(preview);const processed=document.createElement('img');processed.src=decoder.canvas.toDataURL();processed.width=300;processed.alt='명암 보정 후';li.append(processed);}
      // A deterministic regression for the former full-frame/default-hints path.
      if(item.name==='고해상도 영상 하단의 작은 바코드'){
        const previous=new ZXingBrowser.BrowserMultiFormatReader();previous.possibleFormats=[ZXingBrowser.BarcodeFormat.EAN_13];
        let oldResult='인식 실패';try{oldResult=previous.decodeFromCanvas(canvas).getText();}catch{}
        const comparison=document.createElement('li');comparison.textContent='이전 방식 비교 · '+oldResult;document.getElementById('cases').append(comparison);
      }
      await new Promise(resolve=>setTimeout(resolve,0));
    }
    output.textContent=`검사 ${passed===cases.length?'통과':'실패'} · ${passed}/${cases.length}`;
  }catch(error){output.textContent='검사 실패 · '+error.message;}
}
run();
