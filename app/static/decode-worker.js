/* One frame at a time; expensive decoding never blocks the camera preview. */
'use strict';
// The pinned ZXing browser bundle reads window.__extends at module load.
// It uses only canvas decoding here, so no DOM shim is needed.
self.window=self;
importScripts('/static/scanner.js','/static/scanner-wasm.js','/static/camera-engine.js','/static/advanced-reader.js');
const decoder=new BookCamera.CameraDecoder();
self.onmessage=async({data})=>{
  const {id,bitmap,pass,small,precise}=data;
  const started=performance.now();
  try{
    let code=null;
    for(let step=0;step<(precise?15:1)&&!code;step++){
      const current=precise?step:pass;
      code=decoder.read(bitmap,current,{small});
      if(!code&&(precise||current%3===2))code=await AdvancedBarcode.read(decoder.context.getImageData(0,0,decoder.canvas.width,decoder.canvas.height));
    }
    self.postMessage({id,code,elapsed:Math.round(performance.now()-started)});
  }catch(error){self.postMessage({id,error:error?.message||'바코드 처리 실패'});}
  finally{bitmap.close();}
};
