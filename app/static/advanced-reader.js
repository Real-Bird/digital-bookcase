(function(){
  'use strict';let ready=null;
  async function read(source){
    if(!globalThis.ZXingWASM)throw new Error('강화 해독 모듈을 불러오지 못했습니다. 새로고침하세요.');
    if(!ready)ready=ZXingWASM.prepareZXingModule({overrides:{locateFile:path=>path.endsWith('.wasm')?'/static/zxing_reader.wasm':path},fireImmediately:true});
    await ready;
    const results=await ZXingWASM.readBarcodes(source,{formats:['EAN-13'],tryHarder:true,tryRotate:true,tryInvert:true,tryDownscale:false,minLineCount:2,maxNumberOfSymbols:10});
    return results.map(r=>r.text).find(text=>BookCamera.validISBN(text)) || null;
  }
  globalThis.AdvancedBarcode={read};
})();
