/* Local-only EAN-13 decoding. No camera pixels leave the browser. */
(function(){
  'use strict';
  function validISBN(code){
    if(!/^(978|979)\d{10}$/.test(code)||code.startsWith('9790'))return false;
    return [...code].reduce((sum,c,i)=>sum+Number(c)*(i%2?3:1),0)%10===0;
  }
  class CameraDecoder{
    constructor(){
      // DecodeHintType values from the pinned ZXing library: POSSIBLE_FORMATS=2, TRY_HARDER=3.
      this.reader=new ZXingBrowser.BrowserMultiFormatReader(new Map([[2,[ZXingBrowser.BarcodeFormat.EAN_13]],[3,true]]));
      this.canvas=typeof document==='undefined'?new OffscreenCanvas(1,1):document.createElement('canvas');
      this.context=this.canvas.getContext('2d',{willReadFrequently:true});
    }
    read(source,pass=0,options={}){
      const sw=source.videoWidth || source.naturalWidth || source.width;
      const sh=source.videoHeight || source.naturalHeight || source.height;
      if(!sw||!sh)return null;
      // Sweep overlapping horizontal regions as well as the full frame. Preserve quiet zones.
      const regions=options.small?
        [[.25,.25,.5,.5],[.2,.35,.6,.3],[.325,.25,.35,.5],[.375,.3,.25,.4],[0,0,1,1]]:
        [[0,0,1,1],[0,.2,1,.6],[.12,.1,.76,.8],[0,0,1,.55],[0,.45,1,.55]];
      const region=regions[pass%regions.length];
      const rotation=Math.floor(pass/regions.length)%3;
      const angle=rotation===1?Math.PI/2:rotation===2?-Math.PI/2:0;
      const width=sw*region[2], height=sh*region[3];
      // Preserve the native 1080p frame. Downsampling 1920 -> 1600 can erase
      // one-pixel bars. Small mode enlarges only cropped sensor pixels.
      const scale=options.small&&region[2]<1?Math.min(3,1800/width):Math.min(1,2560/width);
      const w=Math.round(width*scale),h=Math.round(height*scale);
      const canvas=this.canvas,ctx=this.context;
      canvas.width=angle?h:w;canvas.height=angle?w:h;
      ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
      ctx.save();ctx.translate(canvas.width/2,canvas.height/2);ctx.rotate(angle);
      // Disable interpolation when enlarging fine bars.
      ctx.imageSmoothingEnabled=scale<1;
      ctx.drawImage(source,sw*region[0],sh*region[1],width,height,-w/2,-h/2,w,h);ctx.restore();
      if(pass%3!==0){
        const image=ctx.getImageData(0,0,canvas.width,canvas.height),data=image.data,histogram=new Uint32Array(256);
        for(let i=0;i<data.length;i+=4){const grey=Math.round(.299*data[i]+.587*data[i+1]+.114*data[i+2]);data[i]=data[i+1]=data[i+2]=grey;histogram[grey]++;}
        // Stretch measured luminance rather than a fixed mid-grey: bright webcams can
        // put both the black ink and paper above 128, where a fixed threshold fails.
        const trim=canvas.width*canvas.height*.002;let low=0,high=255,sum=0;
        for(let i=0;i<256;i++){sum+=histogram[i];if(sum>trim){low=i;break;}}
        sum=0;for(let i=255;i>=0;i--){sum+=histogram[i];if(sum>trim){high=i;break;}}
        const range=Math.max(20,high-low);
        for(let i=0;i<data.length;i+=4){let value=Math.max(0,Math.min(255,(data[i]-low)*255/range));if(pass%3===2)value=value<128?0:255;data[i]=data[i+1]=data[i+2]=value;}
        ctx.putImageData(image,0,0);
      }
      try{const value=this.reader.decodeFromCanvas(canvas).getText();return validISBN(value)?value:null;}
      catch(error){
        if(['NotFoundException','ChecksumException','FormatException'].includes(error?.constructor?.name)||['NotFoundException','ChecksumException','FormatException'].includes(error?.name)||error?.getKind)return null;
        throw error;
      }
    }
  }
  globalThis.BookCamera={CameraDecoder,validISBN};
})();
