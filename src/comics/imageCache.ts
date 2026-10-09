/** Deduplicate reads while bounding settled base64 memory across document switches. */
export function stringCache(maxBytes:number,maxEntries:number) {
  const cache=new Map<string,{promise:Promise<string>;bytes:number;settled:boolean}>();
  let bytes=0;
  function trim() {
    for(const [key,entry] of cache) {
      if(bytes<=maxBytes&&cache.size<=maxEntries)break;
      if(!entry.settled)continue;
      cache.delete(key);bytes-=entry.bytes;
    }
  }
  return (key:string,read:()=>Promise<string>)=>{
    const old=cache.get(key);
    if(old){cache.delete(key);cache.set(key,old);return old.promise;}
    const entry={promise:Promise.resolve(''),bytes:0,settled:false};
    entry.promise=Promise.resolve().then(read).then(value=>{
      entry.bytes=value.length*2;entry.settled=true;
      if(cache.get(key)===entry){bytes+=entry.bytes;trim();}
      return value;
    },error=>{if(cache.get(key)===entry)cache.delete(key);throw error;});
    cache.set(key,entry);return entry.promise;
  };
}
