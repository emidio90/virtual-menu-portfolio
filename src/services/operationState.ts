/** In-memory identity versioning prevents stale async work crossing account boundaries. */
export function createIdentityGate(initialUid:string|null=null){
 let uid=initialUid;let epoch=0;
 return {
  transition(nextUid:string|null){if(nextUid!==uid){uid=nextUid;epoch++}return epoch},
  invalidate(){epoch++},
  capture(){return {uid,epoch}},
  current(ticket:{uid:string|null;epoch:number}){return ticket.uid===uid&&ticket.epoch===epoch},
 };
}
/** Ambiguous retries keep an operation identity for the exact original payload. */
export function createRequestRegistry(){
 const ids=new Map<string,string>();
 return {get(key:string){let id=ids.get(key);if(!id){id=crypto.randomUUID();ids.set(key,id)}return id},complete(key:string){ids.delete(key)},clear(){ids.clear()}};
}
export function isAmbiguous(error:unknown):boolean{return Boolean(error&&typeof error==='object'&&'ambiguous' in error&&error.ambiguous)}
export function responseIsAmbiguous(status:number,code?:string):boolean{
 if(code==='PARSE_PENDING'||code==='ALREADY_GENERATING'||code==='ORDER_PENDING')return true;
 if(code&&['PARSE_FAILED','PARSE_FAILED_PREVIOUSLY','GENERATION_FAILED','INVALID_AI_OUTPUT','PAYMENTS_DISABLED'].includes(code))return false;
 return status>=500;
}
