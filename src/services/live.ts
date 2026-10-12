import type { StudioApi, User, Dish, GenerationConfig, CreditPackage } from '../types';
import type { Auth, User as FirebaseUser } from 'firebase/auth';
import { createIdentityGate, responseIsAmbiguous } from './operationState';

export interface LiveSession {api:StudioApi; signIn(email:string,password:string):Promise<void>; register(email:string,password:string):Promise<void>; resetPassword(email:string):Promise<void>; signOut():Promise<void>; subscribe(callback:(user:FirebaseUser|null)=>void):()=>void; verifyEmail():Promise<void>; refreshVerification():Promise<boolean>; dispose():void}
export async function createLiveSession():Promise<LiveSession> {
 const [{initializeApp,getApps},authModule]=await Promise.all([import('firebase/app'),import('firebase/auth')]);
 const firebaseConfig={apiKey:import.meta.env.VITE_FIREBASE_API_KEY,authDomain:import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,projectId:import.meta.env.VITE_FIREBASE_PROJECT_ID,appId:import.meta.env.VITE_FIREBASE_APP_ID};
 if(Object.values(firebaseConfig).some(value=>!value))throw new Error('Live mode needs a complete Firebase configuration. Ask the project operator to configure this deployment.');
 const app=getApps()[0]||initializeApp(firebaseConfig);
 const auth:Auth=authModule.getAuth(app);
 const identity=createIdentityGate(auth.currentUser?.uid||null);
 const imageCache=new Map<string,{source:string;url:string}>();
 const revoke=(id:string)=>{const cached=imageCache.get(id);if(cached){URL.revokeObjectURL(cached.url);imageCache.delete(id)}};
 const clear=()=>{identity.invalidate();for(const id of imageCache.keys())revoke(id)};
 function syncIdentity(){const uid=auth.currentUser?.uid||null;if(identity.capture().uid!==uid){clear();identity.transition(uid)}}
 function capture(){syncIdentity();const actor=auth.currentUser;if(!actor)throw new Error('Sign in to access your studio.');return {actor,ticket:identity.capture()}}
 function assertCurrent(context:ReturnType<typeof capture>){if(!identity.current(context.ticket)||auth.currentUser?.uid!==context.actor.uid)throw Object.assign(new Error('Your account changed. The previous operation was discarded.'),{staleIdentity:true})}
 async function request<T>(path:string,body?:unknown,method=body?'POST':'GET',context=capture()):Promise<T>{
  assertCurrent(context);const token=await context.actor.getIdToken();assertCurrent(context);
  let response:Response;
  try{response=await fetch(`/api${path}`,{method,headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,credentials:'same-origin'})}
  catch{assertCurrent(context);throw Object.assign(new Error('The request could not be confirmed. Retry to check the same operation safely.'),{ambiguous:true})}
  assertCurrent(context);if(response.status===204)return undefined as T;
  let data:{error?:string;code?:string};
  try{data=await response.json()}catch{assertCurrent(context);throw Object.assign(new Error('The server response could not be confirmed. Retry the same operation.'),{ambiguous:true})}
  assertCurrent(context);if(!response.ok)throw Object.assign(new Error(data.error||`Request failed (${response.status}).`),{ambiguous:responseIsAmbiguous(response.status,data.code),code:data.code});
  return data as T;
 }
 async function hydrate(dish:Dish,context:ReturnType<typeof capture>,force=false):Promise<Dish>{
  assertCurrent(context);
  if(!dish.imageUrl||dish.status!=='completed'){revoke(dish.id);return {...dish,imageUrl:undefined}}
  const url=new URL(dish.imageUrl,location.origin);
  if(url.origin!==location.origin||url.pathname!==`/api/dishes/${encodeURIComponent(dish.id)}/image`)throw new Error('The server returned an unexpected image destination.');
  const cached=imageCache.get(dish.id);if(cached&&cached.source===dish.imageUrl&&!force)return {...dish,imageUrl:cached.url};
  const token=await context.actor.getIdToken();assertCurrent(context);
  let response:Response;
  try{response=await fetch(url.pathname,{headers:{Authorization:`Bearer ${token}`},credentials:'same-origin'})}catch{assertCurrent(context);throw Object.assign(new Error('Your image could not be loaded. Refresh the workspace to try again.'),{ambiguous:true})}
  assertCurrent(context);if(!response.ok)throw Object.assign(new Error('Your image could not be loaded. Refresh the workspace to try again.'),{ambiguous:true});
  const blob=await response.blob();assertCurrent(context);if(!blob.type.startsWith('image/'))throw new Error('The server returned an unexpected image format.');
  const objectUrl=URL.createObjectURL(blob);revoke(dish.id);imageCache.set(dish.id,{source:dish.imageUrl,url:objectUrl});return {...dish,imageUrl:objectUrl};
 }
 const api:StudioApi={
  async me(){return (await request<{user:User}>('/me')).user},
  async dishes(){const context=capture();const items=(await request<{dishes:Dish[]}>('/dishes',undefined,'GET',context)).dishes;assertCurrent(context);for(const id of imageCache.keys())if(!items.some(d=>d.id===id))revoke(id);const hydrated=await Promise.all(items.map(d=>hydrate(d,context)));assertCurrent(context);return hydrated},
  async parse(text,requestId){return (await request<{dishes:Dish[]}>('/parse-menu',{text,requestId})).dishes},
  async generate(id,config:GenerationConfig,requestId){const context=capture();const result=await request<{dish:Dish;credits:number}>(`/dishes/${encodeURIComponent(id)}/generate`,{...config,requestId},'POST',context);const dish=await hydrate(result.dish,context,true);assertCurrent(context);return {...result,dish}},
  async remove(id){const context=capture();await request<void>(`/dishes/${encodeURIComponent(id)}`,undefined,'DELETE',context);assertCurrent(context);revoke(id)},
  async catalog(){return request<{packages:CreditPackage[];enabled:boolean}>('/catalog')},
  async checkout(packageId,requestId){return (await request<{url:string}>('/checkout',{packageId,requestId})).url},
 };
 return {api,
  signIn:async(email,password)=>{await authModule.signInWithEmailAndPassword(auth,email,password)},
  register:async(email,password)=>{const credential=await authModule.createUserWithEmailAndPassword(auth,email,password);if(auth.currentUser?.uid!==credential.user.uid)return;await authModule.sendEmailVerification(credential.user)},
  resetPassword:async(email)=>{await authModule.sendPasswordResetEmail(auth,email)},
  signOut:async()=>{clear();await authModule.signOut(auth)},
  subscribe:(cb)=>authModule.onAuthStateChanged(auth,user=>{syncIdentity();cb(user)}),
  verifyEmail:async()=>{const context=capture();await authModule.sendEmailVerification(context.actor);assertCurrent(context)},
  refreshVerification:async()=>{const context=capture();await context.actor.reload();assertCurrent(context);await context.actor.getIdToken(true);assertCurrent(context);return context.actor.emailVerified},
  dispose:clear,
 };
}
