'use strict';
class CameraWorkerClient{
  constructor(){
    this.worker=new Worker('/static/decode-worker.js');this.sequence=0;this.pending=new Map();
    this.worker.onmessage=({data})=>{const item=this.pending.get(data.id);if(!item)return;clearTimeout(item.timer);this.pending.delete(data.id);data.error?item.reject(new Error(data.error)):item.resolve(data);};
    this.worker.onerror=event=>this.close('바코드 작업 스레드 오류: '+(event.message||'화면을 새로고침하세요.'));
  }
  async read(source,pass,options={}){
    if(!this.worker)throw new Error('인식 작업이 종료되었습니다.');
    if(this.pending.size)throw new Error('이전 프레임 처리 중입니다.');
    const bitmap=await createImageBitmap(source);
    if(!this.worker){bitmap.close();throw new Error('인식 작업이 종료되었습니다.');}
    const id=++this.sequence;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>this.close('인식 시간이 초과되었습니다. 카메라를 다시 켜주세요.'),30000);
      this.pending.set(id,{resolve,reject,timer});
      try{this.worker.postMessage({id,bitmap,pass,...options},[bitmap]);}
      catch(error){bitmap.close();clearTimeout(timer);this.pending.delete(id);reject(error);}
    });
  }
  close(message='카메라가 꺼졌습니다.'){
    this.worker?.terminate();this.worker=null;
    for(const {reject,timer} of this.pending.values()){clearTimeout(timer);reject(new Error(message));}this.pending.clear();
  }
}
globalThis.CameraWorkerClient=CameraWorkerClient;
