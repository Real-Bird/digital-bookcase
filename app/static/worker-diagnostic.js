'use strict';
(async()=>{
  const output=document.getElementById('measurements'),client=new CameraWorkerClient();
  try{
    const image=new Image();image.src='/static/test-ean13.png';await image.decode();
    const canvas=document.createElement('canvas');canvas.width=1920;canvas.height=1080;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#ddd';ctx.fillRect(0,0,1920,1080);ctx.drawImage(image,700,400,476,200);
    let found=await client.read(canvas,0,{precise:true});
    if(found.code!=='9788936434267')throw new Error('작업 스레드 ISBN 인식 실패');
    output.textContent='ISBN 인식 통과: '+found.code+'\n';
    ctx.fillStyle='#ddd';ctx.fillRect(0,0,1920,1080);ctx.imageSmoothingEnabled=false;ctx.drawImage(image,900,510,119,50);
    found=await client.read(canvas,0,{precise:true,small:true});
    if(found.code!=='9788936434267')throw new Error('작은 바코드 인식 실패');
    output.textContent+='폭 119픽셀 작은 바코드 통과\n';
    ctx.fillStyle='#ddd';ctx.fillRect(0,0,1920,1080);ctx.save();ctx.translate(950,300);ctx.rotate(Math.PI/2);ctx.drawImage(image,0,0,476,150);ctx.restore();
    found=await client.read(canvas,0,{precise:true});
    if(found.code!=='9788936434267')throw new Error('세로 바코드 인식 실패');
    output.textContent+='세로 바코드 통과\n';
    // Real image work on identical 1080p blank frames, with event-loop heartbeats.
    ctx.fillStyle='#ddd';ctx.fillRect(0,0,1920,1080);
    async function measure(task){
      const gaps=[];let last=performance.now();const timer=setInterval(()=>{const now=performance.now();gaps.push(now-last);last=now;},10);
      await new Promise(r=>setTimeout(r,30));
      for(let pass=0;pass<8;pass++){await task(pass);await new Promise(r=>setTimeout(r,20));}
      await new Promise(r=>setTimeout(r,30));clearInterval(timer);return Math.round(Math.max(...gaps));
    }
    const old=new BookCamera.CameraDecoder();
    const before=await measure(async pass=>{const code=old.read(canvas,pass,{small:true});if(!code&&pass%3===2)await AdvancedBarcode.read(old.context.getImageData(0,0,old.canvas.width,old.canvas.height));});
    const after=await measure(pass=>client.read(canvas,pass,{small:true}));
    output.textContent+=JSON.stringify({mainThreadMaxDelayMs:before,workerMaxDelayMs:after},null,2)+'\n';
    // Cancellation must reject promptly instead of leaving the scanner busy.
    const stopped=new CameraWorkerClient();const task=stopped.read(canvas,0);stopped.close();
    let cancelled=false;try{await task;}catch{cancelled=true;}if(!cancelled)throw new Error('종료 취소 실패');
    output.textContent+='카메라 종료 시 작업 취소 통과\n';
    document.getElementById('result').textContent='검사 통과';
  }catch(error){document.getElementById('result').textContent='검사 실패: '+error.message;}
  finally{client.close();}
})();
