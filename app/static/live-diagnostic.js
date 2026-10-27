let stream,working=false;
const el=id=>document.getElementById(id);
const decoder=new BookCamera.CameraDecoder();
// Supply the exact matching WASM binary locally, with no CDN access.
ZXingWASM.prepareZXingModule({overrides:{locateFile:path=>path.endsWith('.wasm')?'/static/zxing_reader.wasm':path}});
async function compare(){
  if(working||!el('camera').videoWidth)return;
  working=true;el('status').textContent='같은 원본 프레임 비교 중';
  try{
    const canvas=el('frame');canvas.width=el('camera').videoWidth;canvas.height=el('camera').videoHeight;
    const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(el('camera'),0,0);
    const data=ctx.getImageData(0,0,canvas.width,canvas.height);
    let jsResult=null;for(let pass=0;pass<5&&!jsResult;pass++)jsResult=decoder.read(canvas,pass,{small:true});
    const results=await ZXingWASM.readBarcodes(data,{formats:['EAN-13'],tryHarder:true,tryRotate:true,tryInvert:true,tryDownscale:false,minLineCount:2,maxNumberOfSymbols:10});
    el('result').textContent=JSON.stringify({resolution:canvas.width+'×'+canvas.height,existing:jsResult,cpp:results.map(r=>({text:r.text,format:r.format,position:r.position,error:r.error}))},null,2);
    el('status').textContent=results.length?'실물 프레임 해독 성공':'두 엔진 결과를 확인하세요';
  }catch(error){el('status').textContent='진단 오류 · '+error.message;}
  finally{working=false;}
}
el('capture').onclick=compare;
el('stop').onclick=()=>{stream?.getTracks().forEach(t=>t.stop());el('status').textContent='카메라 꺼짐';};
el('start').onclick=async()=>{try{el('status').textContent='카메라 연결 중';const devices=await navigator.mediaDevices.enumerateDevices();const preferred=devices.find(d=>d.kind==='videoinput'&&/c922/i.test(d.label));stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{...(preferred?{deviceId:{exact:preferred.deviceId}}:{}),width:{ideal:1920},height:{ideal:1080}}});el('camera').srcObject=stream;await el('camera').play();el('status').textContent='영상 연결 완료 · 비교 버튼을 누르세요';setTimeout(compare,1500);}catch(e){el('status').textContent=e.message;}};
window.addEventListener('beforeunload',()=>stream?.getTracks().forEach(t=>t.stop()));
