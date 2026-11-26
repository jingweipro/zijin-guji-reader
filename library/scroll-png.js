// A long scroll can exceed a mobile canvas's width before its PNG becomes large.
// Render wide images in short bands. Only one band and one small canvas are live.
const GujiScrollPng = (() => {
  const signature = new Uint8Array([137,80,78,71,13,10,26,10]);
  const utf8 = new TextEncoder();
  const crcTable = Uint32Array.from({length:256}, (_,i)=>{
    let n=i;
    for(let bit=0;bit<8;bit++) n=n&1 ? 0xedb88320^(n>>>1) : n>>>1;
    return n>>>0;
  });
  function uint32(n) {
    const bytes=new Uint8Array(4);
    new DataView(bytes.buffer).setUint32(0,n);
    return bytes;
  }
  function chunk(type,data) {
    const code=utf8.encode(type);
    let crc=0xffffffff;
    for(const source of [code,data]) for(const byte of source) crc=crcTable[(crc^byte)&255]^(crc>>>8);
    return [uint32(data.length),code,data,uint32((crc^0xffffffff)>>>0)];
  }
  function notice(credits) {
    if(!credits.length) return [];
    // PNG iTXt: Latin-1 keyword, uncompressed UTF-8 international text.
    return chunk('iTXt',utf8.encode('Description\0\0\0\0\0'+credits.join('\n')));
  }
  function outputSize(width,height) {
    const side=typeof CompressionStream==='function' ? 16384 : 4096;
    const scale=Math.min(3,side/width,4096/height,Math.sqrt(12000000/(width*height)));
    return {width:Math.floor(width*scale),height:Math.floor(height*scale),scale};
  }
  async function encode(plan,draw,credits,active) {
    const size=outputSize(plan.width,plan.height);
    if(size.scale<1)throw Error('长卷过宽');
    const canvas=document.createElement('canvas');
    try{
      if(size.width<=4096 && size.width*size.height<=4200000){
        draw(canvas,0,0,size.width,size.height,size.scale);
        const png=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
        if(!png || png.size<32)throw Error('空白图片');
        return credits.length ? new Blob([png.slice(0,-12),...notice(credits),png.slice(-12)],{type:'image/png'}) : png;
      }
      if(typeof CompressionStream!=='function')throw Error('浏览器需要分页');
      const compressed=new CompressionStream('deflate');
      const writer=compressed.writable.getWriter();
      const header=new Uint8Array([...uint32(size.width),...uint32(size.height),8,2,0,0,0]);
      const pieces=[signature,...chunk('IHDR',header),...notice(credits)];
      const drained=compressed.readable.pipeTo(new WritableStream({write(data){pieces.push(...chunk('IDAT',data))}}));
      // An abort also rejects the reader; consume its rejection before releasing memory.
      drained.catch(()=>{});
      try {
        const stride=1+3*size.width;
        for(let y=0;y<size.height;y+=64){
          if(!active())throw new DOMException('图卡已更新','AbortError');
          const rows=Math.min(64,size.height-y), band=new Uint8Array(stride*rows);
          for(let x=0;x<size.width;x+=1536){
            const width=Math.min(1536,size.width-x);
            const ctx=draw(canvas,x,y,width,rows,size.scale);
            const pixels=ctx.getImageData(0,0,width,rows).data;
            for(let row=0;row<rows;row++){
              let from=row*width*4,to=row*stride+1+x*3;
              for(let i=0;i<width;i++,from+=4){
                band[to++]=pixels[from];band[to++]=pixels[from+1];band[to++]=pixels[from+2];
              }
            }
          }
          // PNG Sub filter on each RGB scanline keeps flat paper and line art compact.
          for(let row=0;row<rows;row++){
            const base=row*stride;
            for(let i=base+stride-1;i>=base+4;i--)band[i]-=band[i-3];
            band[base]=1;
          }
          await writer.write(band);
          await new Promise(resolve=>setTimeout(resolve,0));
        }
        await writer.close();await drained;
      }catch(error){
        await writer.abort(error).catch(()=>{});throw error;
      }
      return new Blob([...pieces,...chunk('IEND',new Uint8Array())],{type:'image/png'});
    }finally{
      // Explicitly surrender IOS backing stores when changing an excerpt or paper.
      canvas.width=canvas.height=1;
    }
  }
  return {outputSize,encode};
})();
