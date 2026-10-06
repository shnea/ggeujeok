const normalize=(name:string)=>name.trim().normalize('NFC').toLocaleLowerCase('und');

// Keep local manual tags while replacing the preceding AI delivery with the new delivery.
export function mergeAiTags(tags:string[],previous:string[],incoming:string[]){
  if(JSON.stringify(previous.map(normalize))===JSON.stringify(incoming.map(normalize)))return tags;
  const old=new Set(previous.map(normalize));
  return [...new Map([...tags.filter(name=>!old.has(normalize(name))),...incoming]
    .map(name=>[normalize(name),name])).values()].slice(0,20);
}
