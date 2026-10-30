// Compatibility facade keeps the existing rendering, spreadsheet and reporting code.
import * as F from 'https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js';

export * from 'https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js';
let catalogVersion=null;
const versions=new Map();
const key=r=>r.path;
const stamp=d=>({...d,updatedAt:d.updatedAt?.toMillis?.()??d.updatedAt});
const wrap=d=>({id:d.id,ref:d.ref,exists:()=>d.exists(),data:()=>d.exists()?stamp(d.data()):undefined});
function entry(r){return /^users\/[^/]+\/entries\/[^/]+$/.test(r.path);}
function remember(d){if(d.exists()) versions.set(key(d.ref),d.data().version||0); return wrap(d);}
export async function setDoc(ref,data){
 if(ref.path.startsWith('masterStock/')) return publish(ref,data);
 if(!entry(ref)) return F.setDoc(ref,{...data,updatedAt:F.serverTimestamp()});
 const expected=data._baseVersion ?? versions.get(key(ref)) ?? 0;
 const {_baseVersion,...payload}=data;
 await F.runTransaction(ref.firestore,async tx=>{
  const old=await tx.get(ref), version=old.data()?.version||0;
  if(version!==expected) throw new Error('Conflict: another device changed this count. Refresh and review before saving again.');
  tx.set(ref,{...payload,extra:!!data.extra,deleted:!!data.deleted,version:version+1,updatedAt:F.serverTimestamp()});
 });
 versions.set(key(ref),expected+1);
}
export async function deleteDoc(ref){
 if(ref.path.startsWith('masterStock/')) return publish(ref,null);
 const old=await F.getDoc(ref); if(!old.exists())return;
 return setDoc(ref,{...old.data(),deleted:true});
}
export function writeBatch(db){const jobs=[];return {set(r,d){jobs.push(()=>setDoc(r,d));},delete(r){jobs.push(()=>deleteDoc(r));},async commit(){for(const job of jobs)await job();}};}
async function pages(ref){let out=[],last; do{const q=F.query(ref,F.orderBy(F.documentId()),...(last?[F.startAfter(last)]:[]),F.limit(250));const s=await F.getDocs(q);out.push(...s.docs);last=s.size===250?s.docs.at(-1):null;}while(last);return out;}
export async function getDocs(ref){const docs=(await pages(ref)).map(d=>{const x=remember(d);return x;}).filter(d=>!d.data().deleted);return {docs,size:docs.length,forEach:fn=>docs.forEach(fn)};}
export async function getDoc(ref){
 if(!ref.path.startsWith('masterStock/'))return wrap(await F.getDoc(ref));
 const current=await F.getDoc(F.doc(ref.firestore,'catalog/current'));catalogVersion=current.data()?.version||null;
 if(!catalogVersion)return {exists:()=>false};
 const pub=await pages(F.collection(ref.firestore,`catalogs/${catalogVersion}/products`));
 const priv=await pages(F.collection(ref.firestore,`privateCatalogs/${catalogVersion}/products`));
 const q=Object.fromEntries(priv.map(d=>[d.id,d.data().expected]));
 const items=pub.map(d=>({...d.data(),expected:q[d.id]}));
 return {exists:()=>true,data:()=>ref.id==='system'?{q,...current.data()}:{...stamp(current.data()),items,namesOnly:items.every(x=>x.expected===null)}};
}
async function publish(ref,data){
 const cur=await getDoc(F.doc(ref.firestore,'masterStock/current'));
 let items=cur.exists()?cur.data().items:[];
 if(ref.id==='current')items=data?data.items.map(x=>({...x,expected:data.namesOnly?null:x.expected})):[];
 else items=items.map(x=>({...x,expected:data?(data.q[x.id]??0):null}));
 const baseVersion=catalogVersion, db=ref.firestore, version=crypto.randomUUID();
 const ids=new Set(),names=new Set();
 for(const x of items){
  const n=x.name?.normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();
  if(!/^p[a-z0-9]{1,16}$/.test(x.id)||!n||x.name.length>300||ids.has(x.id)||names.has(n)||!(x.expected===null||(Number.isFinite(x.expected)&&Math.abs(x.expected)<=1e9)))throw Error('Invalid or duplicate product');
  ids.add(x.id);names.add(n);
 }
 for(let start=0;start<items.length;start+=200){
  const batch=F.writeBatch(db);
  for(const x of items.slice(start,start+200)){
   batch.set(F.doc(db,`catalogs/${version}/products/${x.id}`),{id:x.id,name:x.name});
   batch.set(F.doc(db,`privateCatalogs/${version}/products/${x.id}`),{expected:x.expected});
  }
  await batch.commit();
 }
 await F.runTransaction(db,async tx=>{
  const pointer=F.doc(db,'catalog/current'),old=await tx.get(pointer);
  if((old.data()?.version||null)!==baseVersion)throw Error('Another administrator changed stock. Refresh and retry.');
  tx.set(pointer,{version,count:items.length,fileName:data?.fileName||'Cleared',updatedAt:F.serverTimestamp()});
 });
 catalogVersion=version;
 return {version};
}
export function onSnapshot(ref,...args){
 const callback=args.find(x=>typeof x==='function'), error=args.filter(x=>typeof x==='function')[1];
 return F.onSnapshot(ref,{includeMetadataChanges:true},s=>{
  if(s.docs){const docs=s.docs.map(remember).filter(d=>!d.data().deleted);callback({docs,metadata:s.metadata,docChanges:()=>s.docChanges()});}
  else callback(s.exists()?wrap(s):s);
 },error);
}
export function watchProducts(db,callback,error){
 let generation=0,closed=false;
 const off=F.onSnapshot(F.doc(db,'catalog/current'),async s=>{
  const g=++generation;
  try{const docs=s.exists()?await pages(F.collection(db,`catalogs/${s.data().version}/products`)):[];
   if(!closed&&g===generation)callback(docs.map(d=>({...d.data(),expected:null})),s.data()||{});
  }catch(e){error(e);}
 },error);
 return ()=>{closed=true;generation++;off();};
}
