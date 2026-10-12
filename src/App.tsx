import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, ArrowUpRight, Camera, Check, ChefHat, ChevronRight, Coins, Download, FileText, Image as ImageIcon, Info, Layers, LayoutGrid, Loader2, LogOut, Maximize2, Plus, RotateCcw, ShieldCheck, SlidersHorizontal, Sparkles, Trash2, Wand2 } from 'lucide-react';
import { Modal } from './components/Modal';
import { createDemoApi } from './services/demo';
import { DEMO_EXPORT_SIZES, demoPhotoAlt, demoPhotoUrl } from './services/demoPhotos';
import type { LiveSession } from './services/live';
import {createIdentityGate,createRequestRegistry,isAmbiguous} from './services/operationState';
import { COST, DEMO_MENU, type CreditPackage, type Dish, type GenerationConfig, type ImageSize, type PhotoStyle, type StudioApi, type User } from './types';

const LIVE=import.meta.env.VITE_APP_MODE==='live';
const STYLE_OPTIONS:{name:PhotoStyle;title:string;description:string;className:string}[]=[
 {name:'Rustic/Dark',title:'Rustic / Dark',description:'Moody, warm & textured',className:'rustic'},
 {name:'Bright/Modern',title:'Bright / Modern',description:'Fresh, airy & minimal',className:'modern'},
 {name:'Social Media',title:'Social Media',description:'Bold, colorful & playful',className:'social'},
];
const errorText=(error:unknown)=>error instanceof Error?error.message:'Something went wrong. Please try again.';
function Brand({onClick}:{onClick:()=>void}){return <button className="brand" onClick={onClick} aria-label="Virtual Menu home"><span className="brand-icon"><ChefHat size={22}/></span><span>Virtual Menu<span className="brand-dot">.</span></span></button>}

export default function App(){
 const [route,setRoute]=useState(location.hash==='#studio'?'studio':'home');
 const [api,setApi]=useState<StudioApi|null>(()=>LIVE?null:createDemoApi());
 const [session,setSession]=useState<LiveSession|null>(null);
 const [user,setUser]=useState<User|null>(null);
 const [dishes,setDishes]=useState<Dish[]>([]);
 const [config,setConfig]=useState<GenerationConfig>({style:'Bright/Modern',size:'1K'});
 const [menu,setMenu]=useState(DEMO_MENU);
 const [busy,setBusy]=useState(false);
 const lock=useRef(false);
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');
 const [modal,setModal]=useState<'about'|'credits'|'auth'|'reset'|null>(null);
 const [preview,setPreview]=useState<Dish|null>(null);
 const [toDelete,setToDelete]=useState<Dish|null>(null);
 const [authMode,setAuthMode]=useState<'signin'|'register'|'reset'>('signin');
 const [email,setEmail]=useState('');const [password,setPassword]=useState('');
 const [authMessage,setAuthMessage]=useState('');
 const [catalog,setCatalog]=useState<{packages:CreditPackage[];enabled:boolean}|null>(null);
 const [filter,setFilter]=useState<'all'|'completed'|'pending'>('all');
 const [downloadBusy,setDownloadBusy]=useState(false);
 const downloadLock=useRef(false);
 const [initializing,setInitializing]=useState(LIVE);
 const [emailVerified,setEmailVerified]=useState(false);
 const identity=useRef(createIdentityGate(LIVE?null:'demo'));
 const [identityVersion,setIdentityVersion]=useState(0);
 const parseKeys=useRef(createRequestRegistry());
 const checkoutKeys=useRef(createRequestRegistry());
 const generationKeys=useRef(new Map<string,{requestId:string;config:GenerationConfig}>());

 const navigate=useCallback((next:'home'|'studio')=>{location.hash=next==='studio'?'studio':'home';setRoute(next);window.scrollTo({top:0,behavior:'instant'})},[]);
 useEffect(()=>{const change=()=>setRoute(location.hash==='#studio'?'studio':'home');window.addEventListener('hashchange',change);return()=>window.removeEventListener('hashchange',change)},[]);
 function clearIdentityView(){
  setUser(null);setDishes([]);setPreview(null);setToDelete(null);setCatalog(null);setModal(null);
  setMenu(DEMO_MENU);setConfig({style:'Bright/Modern',size:'1K'});setFilter('all');
  setPassword('');setEmail('');setAuthMessage('');setError('');setNotice('');setEmailVerified(false);
  generationKeys.current.clear();parseKeys.current.clear();checkoutKeys.current.clear();
  lock.current=false;setBusy(false);downloadLock.current=false;setDownloadBusy(false);
 }
 useEffect(()=>{
  if(!LIVE)return;
  let active=true;let unsubscribe:(()=>void)|undefined;let cleanup:(()=>void)|undefined;
  import('./services/live').then(module=>module.createLiveSession()).then(value=>{
   if(!active){value.dispose();return;}
   cleanup=value.dispose;setSession(value);
   unsubscribe=value.subscribe(authUser=>{
    if(!active)return;
    const uid=authUser?.uid||null;
    if(identity.current.capture().uid!==uid){identity.current.transition(uid);value.dispose();clearIdentityView();setIdentityVersion(v=>v+1)}
    if(authUser){setEmailVerified(authUser.emailVerified);setApi(value.api);setInitializing(false);setModal(null);navigate('studio')}
    else{setApi(null);setInitializing(false);if(location.hash==='#studio'){setModal('auth');navigate('home')}}
   });
  }).catch(e=>{if(active){setError(errorText(e));setInitializing(false)}});
  return()=>{active=false;identity.current.invalidate();unsubscribe?.();cleanup?.()};
 },[navigate]);
 const refresh=useCallback(async()=>{
  if(!api)return;const ticket=identity.current.capture();
  const [profile,items]=await Promise.all([api.me(),api.dishes()]);
  if(!identity.current.current(ticket))return;
  setUser(profile);setDishes(items);
  // Polling cannot prove which request produced a completed snapshot. Keep unresolved IDs until their direct response.
 },[api]);
 useEffect(()=>{const ticket=identity.current.capture();refresh().catch(e=>{if(identity.current.current(ticket))setError(errorText(e))})},[refresh,identityVersion]);
 useEffect(()=>{
  if(!LIVE||!api||!dishes.some(d=>d.status==='generating'))return;
  const ticket=identity.current.capture();
  const id=window.setInterval(()=>{if(identity.current.current(ticket))refresh().catch(e=>{if(identity.current.current(ticket))setError(errorText(e))})},3000);
  return()=>window.clearInterval(id);
 },[api,dishes,refresh]);
 useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>setNotice(''),5000);return()=>clearTimeout(timer)},[notice]);
 useEffect(()=>{
  if(modal!=='credits'||!api)return;
  const ticket=identity.current.capture();let active=true;setCatalog(null);
  api.catalog().then(value=>{if(active&&identity.current.current(ticket))setCatalog(value)}).catch(e=>{if(active&&identity.current.current(ticket))setError(errorText(e))});
  return()=>{active=false};
 },[modal,api,identityVersion]);
 function openStudio(){if(LIVE&&!user){setAuthMessage('');setModal('auth')}else navigate('studio')}
 async function run(action:(current:()=>boolean)=>Promise<void>){
  if(lock.current)return;const ticket=identity.current.capture();const current=()=>identity.current.current(ticket);
  lock.current=true;setBusy(true);setError('');
  try{await action(current)}catch(e){
   if(!current())return;setError(errorText(e));
   if(api)try{const profile=await api.me();if(current())setUser(profile)}catch{/* Preserve the original action error. */}
  }finally{if(current()){lock.current=false;setBusy(false)}}
 }
 function parseMenu(){
  if(!api||!menu.trim())return;const text=menu;
  void run(async current=>{
   const requestId=parseKeys.current.get(text);
   try{const added=await api.parse(text,requestId);if(!current())return;
    parseKeys.current.complete(text);setDishes(prev=>[...added,...prev.filter(d=>!added.some(a=>a.id===d.id))]);setMenu('');setFilter('all');setNotice(`${added.length} ${added.length===1?'dish':'dishes'} added to your shot list`);
   }catch(e){if(current()&&!isAmbiguous(e))parseKeys.current.complete(text);throw e}
  });
 }
 async function generateOne(dish:Dish){
  if(!api)return;const ticket=identity.current.capture();const current=()=>identity.current.current(ticket);
  setDishes(prev=>prev.map(d=>d.id===dish.id?{...d,status:'generating',error:undefined}:d));
  try{
   const operation=generationKeys.current.get(dish.id)||{requestId:crypto.randomUUID(),config:{...config}};generationKeys.current.set(dish.id,operation);
   const result=await api.generate(dish.id,operation.config,operation.requestId);if(!current())return;
   if(result.dish.status!=='generating')generationKeys.current.delete(dish.id);
   setDishes(prev=>prev.map(d=>d.id===dish.id?result.dish:d));setUser(prev=>prev?{...prev,credits:result.credits}:prev);
  }catch(e){
   if(!current())return;const ambiguous=isAmbiguous(e);
   if(!ambiguous)generationKeys.current.delete(dish.id);
   setDishes(prev=>prev.map(d=>d.id===dish.id?{...d,status:ambiguous?'generating':'error',error:errorText(e)}:d));
   if(ambiguous)try{await refresh()}catch{/* Status polling reconciles the existing request. */}
   if(current())throw e;
  }
 }
 function generateAll(){void run(async current=>{
  let credits=user?.credits||0;const pending=dishes.filter(d=>d.status==='pending'||d.status==='error');let count=0;
  for(const dish of pending){if(!current()||credits<COST[config.size])break;await generateOne(dish);if(!current())return;credits-=COST[config.size];count++}
  if(current())setNotice(`${count} ${count===1?'preview':'previews'} prepared${count<pending.length?' · Add credits to finish the rest':''}`);
 })}
 function deleteDish(){if(!api||!toDelete)return;const target=toDelete;void run(async current=>{await api.remove(target.id);if(!current())return;setDishes(prev=>prev.filter(d=>d.id!==target.id));setToDelete(null);setNotice(`${target.name} removed`)})}
 async function download(dish:Dish){
  if(!dish.imageUrl||downloadLock.current)return;const ticket=identity.current.capture();const current=()=>identity.current.current(ticket);
  downloadLock.current=true;setDownloadBusy(true);setError('');
  try{
   let blob:Blob;
   if(!LIVE){
    const img=new Image();img.src=dish.imageUrl;await img.decode();if(!current())return;
    const canvas=document.createElement('canvas');const edge=DEMO_EXPORT_SIZES[dish.styleConfig?.size||'1K'];canvas.width=edge;canvas.height=edge;
    const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Your browser could not prepare this download.');ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(img,0,0,edge,edge);
    blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('Download could not be prepared.')),'image/png'));
   }else{const response=await fetch(dish.imageUrl);if(!current())return;if(!response.ok)throw new Error('The image could not be downloaded. Please try again.');blob=await response.blob()}
   if(!current())return;
   const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;const extension=blob.type==='image/jpeg'?'jpg':blob.type==='image/webp'?'webp':'png';const exportName=!LIVE&&dish.demoImage?.representative?dish.demoImage.subject:dish.name;a.download=`${exportName.toLowerCase().replace(/[^a-z0-9]+/g,'-')}${LIVE?'':`-ai-sample-${(dish.styleConfig?.size||'1K').toLowerCase()}${dish.styleConfig?.size&&dish.styleConfig.size!=='1K'?'-upscaled':''}`}.${extension}`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);setNotice('Image download prepared');
  }catch(e){if(current())setError(errorText(e))}finally{if(current()){downloadLock.current=false;setDownloadBusy(false)}}
 }
 function checkout(pack:CreditPackage){if(!api)return;void run(async current=>{
  const requestId=checkoutKeys.current.get(pack.id);
  try{const url=await api.checkout(pack.id,requestId);if(!current())return;
   const parsed=new URL(url);if(parsed.protocol!=='https:'||parsed.hostname!=='checkout.stripe.com')throw Object.assign(new Error('The server returned an unexpected checkout destination.'),{ambiguous:true});
   checkoutKeys.current.complete(pack.id);location.assign(url);
  }catch(e){if(current()&&!isAmbiguous(e))checkoutKeys.current.complete(pack.id);throw e}
 })}
 function resetDemo(){void run(async current=>{await api?.reset?.();if(!current())return;await refresh();if(!current())return;parseKeys.current.clear();generationKeys.current.clear();setMenu(DEMO_MENU);setConfig({style:'Bright/Modern',size:'1K'});setFilter('all');setModal(null);setNotice('Fresh workspace, ready to explore')})}
 function sendVerification(){void run(async current=>{await session?.verifyEmail();if(current())setNotice('Verification email requested. Check your inbox.')})}
 function refreshVerification(){void run(async current=>{const verified=await session?.refreshVerification();if(!current())return;setEmailVerified(Boolean(verified));if(verified){await refresh();if(current())setNotice('Email verified. Your studio is ready.')}else setNotice('Your email is not verified yet. Open the link in your inbox first.')})}
 function signOut(){
  identity.current.invalidate();clearIdentityView();setApi(null);navigate('home');const ticket=identity.current.capture();
  void session?.signOut().catch(e=>{if(identity.current.current(ticket))setError(errorText(e))});
 }
 async function submitAuth(event:FormEvent){event.preventDefault();if(!session)return;setAuthMessage('');void run(async current=>{
  try{if(authMode==='reset'){await session.resetPassword(email);if(current())setAuthMessage('If this email has an account, a reset link will arrive shortly.');return}
   if(authMode==='register')await session.register(email,password);else await session.signIn(email,password);
   // The auth subscription alone owns successful identity transition and navigation.
  }catch{if(current())setAuthMessage(authMode==='reset'?'Unable to request a reset. Check your email and try again.':'Could not sign in. Check your details, or use password reset.')}
 })}
 const completed=dishes.filter(d=>d.status==='completed').length;
 const pending=dishes.filter(d=>d.status==='pending'||d.status==='error').length;
 const generating=dishes.some(d=>d.status==='generating');
 const shown=dishes.filter(d=>filter==='all'||(filter==='completed'?d.status==='completed':d.status!=='completed'));

 return <>
  {route==='home'?<div className="landing">
   <header className="site-header"><div className="container header-content"><Brand onClick={()=>navigate('home')}/><nav aria-label="Main navigation"><button className="text-button desktop-link" onClick={()=>setModal('about')}>Behind the build <ArrowUpRight size={15}/></button><button className="button button-light small" onClick={openStudio} disabled={initializing}>{initializing?'Connecting…':LIVE?'Open studio':'Try the demo'}<ArrowRight size={16}/></button></nav></div></header>
   <main>
    <section className="hero container">
     <div className="hero-copy"><span className="eyebrow"><span className="status-dot"/>{LIVE?'MENU-TO-IMAGE STUDIO':'INTERACTIVE PORTFOLIO · NO SIGN-UP'}</span><h1>Good food.<br/>Better first<br/><span>impressions.</span></h1><p>Your menu is the starting point.<br className="desktop-break"/> Turn dish descriptions into a cohesive visual collection, in one thoughtfully simple studio.</p><div className="hero-actions"><button className="button button-primary large" onClick={openStudio} disabled={initializing}>Explore the studio <ArrowRight size={18}/></button><button className="text-button" onClick={()=>setModal('about')}>How it works <ChevronRight size={16}/></button></div><div className="hero-footnote"><ShieldCheck size={15}/>{LIVE?'Authenticated workspace · Server-managed credits':'Runs in your browser · No account, no API calls'}</div></div>
     <div className="hero-art" aria-label="Pre-generated AI food photography samples">
      <div className="hero-orbit orbit-one"/><div className="hero-orbit orbit-two"/>
      <div className="floating-tag tag-top"><Sparkles size={15}/><span>A little more appetite appeal.</span></div>
      <figure className="hero-card hero-card-main"><img src={demoPhotoUrl('pasta','Rustic/Dark')} alt="AI-generated sample of lemon and herb ribbon pasta on rustic stoneware" width={1024} height={1024} fetchPriority="high"/><figcaption><div><span className="caption-overline">THE EVERYDAY, REIMAGINED</span><strong>Lemon & herb pasta</strong></div><span className="round-arrow"><ArrowUpRight size={22}/></span></figcaption></figure>
      <figure className="hero-card hero-card-small"><img src={demoPhotoUrl('bowl','Social Media')} alt="AI-generated sample of a colorful roasted harvest bowl" width={1024} height={1024}/><figcaption><span>Fresh perspective.</span><span className="mini-dot"/></figcaption></figure>
      <div className="floating-tag tag-bottom"><span className="tiny-icon"><Check size={15}/></span><div><strong>One menu. Three moods.</strong><small>Find your visual flavor</small></div></div>
      <span className="art-disclosure">AI-generated with ChatGPT · Pre-generated samples</span>
     </div>
    </section>
    <section className="workflow-section container" aria-labelledby="workflow-title"><div className="workflow-intro"><span className="eyebrow">LESS FRICTION. MORE FLAVOR.</span><h2 id="workflow-title">From words to a visual menu.</h2><p>A familiar workflow, with room to make it your own.</p></div><div className="workflow-grid">
     <article><span className="step-number">01</span><FileText/><h3>Start with your menu</h3><p>Paste dish names and descriptions. Build a shot list you can work through, one dish at a time.</p></article>
     <article><span className="step-number">02</span><SlidersHorizontal/><h3>Set the visual mood</h3><p>Choose rustic, modern or social. Select a resolution and see the credit cost before you create.</p></article>
     <article><span className="step-number">03</span><ImageIcon/><h3>Make it a collection</h3><p>Preview, refine and download. Explore the flow with nine pre-generated AI food photographs.</p></article>
    </div></section>
    <section className="build-strip container"><div className="build-symbol"><Layers/></div><div><h3>Designed as a product. Built as a portfolio.</h3><p>React + TypeScript, an isolated demo adapter, and an authenticated server boundary for live integrations.</p></div><button className="text-button" onClick={()=>setModal('about')}>Explore the architecture <ArrowUpRight size={17}/></button></section>
   </main><footer className="site-footer container"><Brand onClick={()=>navigate('home')}/><span>A portfolio project. Pre-generated AI photo samples.</span><button className="text-button" onClick={()=>setModal('about')}>About this demo <Info size={14}/></button></footer>
  </div>:<div className="studio">
   <aside className="studio-rail"><Brand onClick={()=>navigate('home')}/><span className="rail-label">WORKSPACE</span><button className="rail-link selected"><LayoutGrid size={18}/>Creative studio<span className="rail-selected-dot"/></button><button className="rail-link" onClick={()=>setModal('about')}><Layers size={18}/>Behind the build<ArrowUpRight size={14}/></button><div className="rail-bottom"><div className="privacy-card"><ShieldCheck size={22}/><strong>{LIVE?'Your own workspace':'Your ideas stay here'}</strong><p>{LIVE?'Account data is accessed through authenticated server endpoints.':'This demo keeps everything in memory. Refreshing starts a fresh workspace.'}</p></div><button className="rail-link back-link" onClick={()=>navigate('home')}><ArrowLeft size={17}/>Back to home</button></div></aside>
   <div className="studio-body"><header className="studio-header"><div className="breadcrumb"><button onClick={()=>navigate('home')} className="mobile-home icon-button" aria-label="Back to home"><ChefHat/></button><span>Workspace</span><ChevronRight size={14}/><strong>Creative studio</strong></div><div className="studio-header-actions"><span className={`mode-pill ${LIVE?'live':''}`}><span className="status-dot"/>{LIVE?'Live workspace':'Photo sample demo'}</span><button className="credits-button" onClick={()=>setModal('credits')}><Coins size={16}/><strong>{user?.credits??'–'}</strong><span>credits</span><Plus size={14}/></button>{LIVE&&user&&<button className="icon-button" title="Sign out" aria-label="Sign out" onClick={signOut}><LogOut size={18}/></button>}</div></header>
   <main className="studio-main"><div className="studio-heading"><div><span className="eyebrow">YOUR CREATIVE WORKSPACE</span><h1>Menu, meet your close-up<span>.</span></h1><p>A few words. A visual mood. Something worth a second look.</p></div><button className="button button-secondary small" onClick={()=>setModal('about')}><Info size={16}/>Demo guide</button></div>
   {!LIVE&&<div className="demo-notice"><span className="notice-icon"><Sparkles size={18}/></span><p><strong>Food photography, generated with ChatGPT.</strong> Explore nine pre-generated samples across three styles. Your menu and credits stay in this browser; previews use existing samples, with no live AI calls.</p><button className="text-button" onClick={()=>setModal('reset')} disabled={busy||generating}>Reset demo <RotateCcw size={14}/></button></div>}
   {LIVE&&user&&!emailVerified&&<div className="demo-notice"><Info size={18}/><p><strong>Verify your email to use live image services.</strong> Open your verification email, then refresh your verification status here.</p><button className="text-button" disabled={busy} onClick={sendVerification}>Send email</button><button className="text-button" disabled={busy} onClick={refreshVerification}>I’ve verified</button></div>}<div className="studio-layout"><aside className="controls-column">
    <section className="control-panel menu-panel"><div className="panel-title"><span className="panel-icon"><FileText size={17}/></span><h2>Your menu</h2><span className="step-chip">01</span></div><p className="panel-subtitle">Give your next collection a starting point.</p><label className="field-label" htmlFor="menu-text">Dish names & descriptions</label><textarea id="menu-text" rows={8} value={menu} maxLength={6000} onChange={e=>setMenu(e.target.value)} placeholder={'Lemon pasta — Fresh herbs and parmesan\nHarvest bowl — Greens, grains and tahini'} disabled={busy}/><div className="textarea-footer"><span>One dish per line · Up to 20 dishes</span><span>{menu.length.toLocaleString()}/6,000</span></div><button className="button button-primary full" onClick={parseMenu} disabled={!menu.trim()||busy||!api||(LIVE&&!emailVerified)}>{busy?<Loader2 className="spin" size={16}/>:<Wand2 size={16}/>}Create shot list<ArrowRight size={16}/></button><button className="text-button sample-button" onClick={()=>{setMenu(DEMO_MENU);document.getElementById('menu-text')?.focus()}} disabled={busy}>Use a sample menu</button></section>
    <section className="control-panel"><div className="panel-title"><span className="panel-icon"><SlidersHorizontal size={17}/></span><h2>Studio settings</h2><span className="step-chip">02</span></div><fieldset className="style-fieldset" disabled={busy}><legend className="field-label">Aesthetic style</legend><div className="style-options">{STYLE_OPTIONS.map(style=><label key={style.name} className={`style-option ${config.style===style.name?'chosen':''}`}><input type="radio" name="style" value={style.name} checked={config.style===style.name} onChange={()=>setConfig(prev=>({...prev,style:style.name}))}/><span className={`style-swatch ${style.className}`}><img src={demoPhotoUrl('pasta',style.name)} alt="" width={44} height={44} loading="lazy"/></span><span className="style-text"><strong>{style.title}</strong><small>{style.description}</small></span><span className="radio-mark">{config.style===style.name&&<Check size={10}/>}</span></label>)}</div></fieldset><fieldset className="size-fieldset" disabled={busy}><legend className="field-label">{LIVE?'Resolution':'PNG export size'}</legend><div className="size-options">{(['1K','2K','4K'] as ImageSize[]).map(size=><label key={size} className={config.size===size?'chosen':''}><input type="radio" name="size" value={size} checked={config.size===size} onChange={()=>setConfig(prev=>({...prev,size}))}/><strong>{size}</strong><span>{COST[size]} {COST[size]===1?'credit':'credits'}</span></label>)}</div></fieldset><div className="settings-hint"><Info size={13}/><span>Settings apply to your next preview.{!LIVE?' Samples are 1024 × 1024. 2K / 4K exports upscale the same image; they add no detail.':''}</span></div></section>
    <div className="local-label"><ShieldCheck size={14}/>{LIVE?'Credits managed on the server':'Browser-only · No data leaves this demo'}</div>
   </aside><section className="collection" aria-labelledby="collection-title"><div className="collection-title-row"><div><h2 id="collection-title">Your shot list <span>{String(dishes.length).padStart(2,'0')}</span></h2><p>{completed} ready to download{pending>0?` · ${pending} waiting for a preview`:''}</p></div><button className="button button-primary small" onClick={generateAll} disabled={busy||generating||(LIVE&&!emailVerified)||pending===0||(user?.credits||0)<COST[config.size]}><Sparkles size={15}/>{busy?'Preparing…':`Create ${pending>0?pending:''} previews`}</button></div><div className="collection-toolbar"><div className="filter-tabs" aria-label="Filter shot list">{(['all','completed','pending'] as const).map(value=><button key={value} aria-pressed={filter===value} className={filter===value?'active':''} onClick={()=>setFilter(value)}>{value==='all'?'All dishes':value==='completed'?'Ready':'To create'}</button>)}</div><span className="collection-caption"><LayoutGrid size={13}/>Collection view</span></div>
    {shown.length===0?<div className="empty-state"><span><ImageIcon size={32}/></span><h3>{dishes.length?'Nothing here yet':'Your next collection starts here'}</h3><p>{dishes.length?'Choose another filter to see your dishes.':'Paste a menu and create your first shot list.'}</p>{dishes.length>0&&<button className="button button-secondary small" onClick={()=>setFilter('all')}>Show all dishes</button>}</div>:<div className="dish-grid">{shown.map(dish=><article className={`dish-card ${dish.status==='error'?'dish-error':''}`} key={dish.id}><div className="dish-visual">{dish.status==='completed'&&dish.imageUrl?<><button className="image-preview-button" onClick={()=>setPreview(dish)} aria-label={`Preview ${dish.name}`}><img src={dish.imageUrl} alt={LIVE?`Image for ${dish.name}`:demoPhotoAlt(dish)} loading="lazy"/></button><span className="image-size-tag">{dish.styleConfig?.size||'1K'}{!LIVE&&dish.styleConfig?.size!=='1K'?' EXPORT':''}</span><span className="fixture-tag">{LIVE?'Ready':dish.demoImage?.representative?'REPRESENTATIVE SAMPLE':'AI-GENERATED SAMPLE'}</span><button className="image-expand" onClick={()=>setPreview(dish)} aria-label={`Expand ${dish.name}`}><Maximize2 size={14}/></button></>:dish.status==='generating'?<div className="dish-placeholder generating"><span className="loading-ring"><Sparkles size={23}/></span><strong>{LIVE?'Creating your image':'Preparing your preview'}</strong><small>{LIVE?'This may take a moment.':'Loading a pre-generated photo…'}</small></div>:dish.status==='error'?<div className="dish-placeholder error-placeholder"><Info size={28}/><strong>Let’s try that again</strong><small>{dish.error}</small></div>:<div className="dish-placeholder"><div className="pending-plate"><Camera size={24}/></div><strong>Ready for its close-up</strong><small>Choose a style, then create a preview</small></div>}<button className="delete-button" aria-label={`Delete ${dish.name}`} disabled={busy||dish.status==='generating'} onClick={()=>setToDelete(dish)}><Trash2 size={14}/></button></div><div className="dish-content"><h3 title={dish.name}>{dish.name}</h3><p title={dish.description}>{dish.description}</p>{!LIVE&&dish.demoImage?.representative&&<p className="sample-caption">Sample shown: {dish.demoImage.subject}</p>}<div className="dish-meta"><span className={`dish-state ${dish.status==='completed'?'complete':''}`}>{dish.status==='completed'?<Check size={11}/>:<span className="small-dot"/>}{dish.status==='completed'?'Ready':dish.status==='generating'?'In progress':dish.status==='error'?'Needs attention':'To create'}</span><span>{dish.styleConfig?.style.split('/')[0]||config.style.split('/')[0]}</span></div><div className="dish-actions"><button className={`button ${dish.status==='completed'?'button-secondary':'button-primary'} small`} disabled={busy||generating||(LIVE&&!emailVerified)||(!generationKeys.current.has(dish.id)&&(user?.credits||0)<COST[config.size])} onClick={()=>void run(()=>generateOne(dish))}>{dish.status==='completed'?<RotateCcw size={13}/>:<Sparkles size={13}/>}<span>{generationKeys.current.has(dish.id)?'Check result':dish.status==='completed'?'Recreate':'Create preview'}</span><span className="cost-chip">{generationKeys.current.has(dish.id)?'↻':COST[config.size]}<Coins size={10}/></span></button><button className="download-button" disabled={dish.status!=='completed'||!dish.imageUrl||downloadBusy} onClick={()=>void download(dish)} aria-label={`Download ${dish.name}`}><Download size={16}/></button></div></div></article>)}</div>}
    <div className="collection-bottom"><span className="tiny-line"/><span>{LIVE?'A consistent collection, one dish at a time.':'Three dishes. Three moods. Nine pre-generated AI photo samples.'}</span><span className="tiny-line"/></div>
   </section></div></main><footer className="studio-footer"><span>Virtual Menu · Creative studio</span><span>{LIVE?'Authenticated live deployment':'Portfolio demo · Session-only workspace'}</span></footer></div>
  </div>}
  {(error||notice)&&<div className={`toast ${error?'toast-error':''}`} role={error?'alert':'status'}><span>{error?<Info size={18}/>:<Check size={18}/>}</span><p>{error||notice}</p><button className="text-button" aria-label="Dismiss notification" onClick={()=>{setError('');setNotice('')}}>Dismiss</button></div>}
  {modal==='about'&&<Modal title="Behind the build" onClose={()=>setModal(null)}><div className="about-intro"><span className="eyebrow">VIRTUAL MENU · PORTFOLIO EDITION</span><h3>The complete flow.<br/>An honest demo.</h3><p>A food-image studio rebuilt around a clear boundary between presentation, local fixtures and server-owned live operations.</p></div><div className="architecture-flow"><span>React UI</span><ChevronRight size={15}/><span>Studio adapter</span><ChevronRight size={15}/><span>{LIVE?'Live API':'Local fixtures'}</span></div><div className="about-grid"><article><ShieldCheck/><h4>Isolated by default</h4><p>Demo mode uses a browser-only adapter, synthetic menu examples and nine locally bundled images generated with ChatGPT. No accounts, live AI requests, analytics or persistent storage.</p></article><article><Layers/><h4>Ready for integration</h4><p>Live mode dynamically loads Firebase Auth. Same-origin API endpoints own dish records, image jobs, credit accounting and optional payment checkout.</p></article></div><div className="honesty-note"><Info size={19}/><div><strong>What the demo does and doesn’t prove</strong><p>Local parsing treats each line as one dish. Previews select an existing AI-generated sample for pasta, a harvest bowl or salmon. Each aesthetic has a distinct photograph. Custom dishes show clearly labeled representative samples; the demo does not generate an image of arbitrary menu input. These samples were generated with ChatGPT, not Gemini. The bundled images are 1024 × 1024; 2K and 4K PNG exports are upscaled and add no detail. Demo credits have no monetary value.</p><p>Live AI, storage, payment and account behavior require separately configured services and are not verified by this demo. This is a portfolio project, not an operating restaurant or a claim of production readiness.</p></div></div><button className="button button-primary full" onClick={()=>{setModal(null);openStudio()}}>Explore the studio<ArrowRight size={16}/></button></Modal>}
  {modal==='credits'&&<Modal title={LIVE?'Studio credits':'Your demo credits'} onClose={()=>setModal(null)}><div className="credits-hero"><span><Coins size={28}/></span><strong>{user?.credits??'–'}</strong><p>{LIVE?'credits available':'simulated credits available'}</p></div><div className="cost-explainer">{(['1K','2K','4K'] as ImageSize[]).map(size=><div key={size}><strong>{size}</strong><span>{COST[size]} {COST[size]===1?'credit':'credits'} / preview</span></div>)}</div>{!LIVE?<><p className="muted modal-copy">These credits let you explore the interaction. They have no monetary value, and no purchase is available. Reset the demo for a fresh 12 credits and the sample collection.</p><button className="button button-primary full" disabled={busy||generating} onClick={()=>setModal('reset')}><RotateCcw size={16}/>Reset demo workspace</button></>:<><p className="muted modal-copy">Your balance is managed by the server. Completed checkout is verified server-side before credits become available.</p>{catalog===null?<p className="muted">Loading credit options…</p>:!catalog.enabled?<div className="honesty-note">Credit checkout is not enabled on this deployment.</div>:<div className="package-list">{catalog.packages.map(pack=><button className="package-option" key={pack.id} disabled={busy} onClick={()=>checkout(pack)}><span><strong>{pack.label}</strong><small>{pack.credits} credits</small></span><span>{new Intl.NumberFormat(undefined,{style:'currency',currency:pack.currency}).format(pack.amount/100)} <ArrowUpRight size={14}/></span></button>)}</div>}</>}</Modal>}
  {modal==='reset'&&<Modal title="Start fresh?" onClose={()=>setModal(null)}><p className="modal-copy muted">This removes the dishes you added in this demo session and restores the three AI-generated sample dishes with 12 simulated credits. Download any previews you want to keep first.</p><div className="modal-actions"><button className="button button-secondary" disabled={busy} onClick={()=>setModal(null)}>Keep working</button><button className="button button-primary" disabled={busy||generating} onClick={resetDemo}><RotateCcw size={15}/>Reset demo</button></div></Modal>}
  {modal==='auth'&&<Modal title={authMode==='signin'?'Welcome to your studio':authMode==='register'?'Create your studio account':'Reset your password'} onClose={()=>{setModal(null);setPassword('')}}><p className="modal-copy muted">{authMode==='reset'?'Enter your account email to request a password reset link.':'This live deployment uses Firebase Authentication. Your studio data is accessed through the server.'}</p><form className="auth-form" onSubmit={submitAuth}><label className="field-label" htmlFor="email">Email address</label><input id="email" type="email" value={email} onChange={e=>setEmail(e.target.value)} autoComplete="email" required/>{authMode!=='reset'&&<><label className="field-label" htmlFor="password">Password</label><input id="password" type="password" value={password} onChange={e=>setPassword(e.target.value)} autoComplete={authMode==='register'?'new-password':'current-password'} minLength={6} required/></>}{authMessage&&<p role="status" className="auth-message">{authMessage}</p>}<button className="button button-primary full" disabled={busy||!session}>{busy?<Loader2 className="spin" size={16}/>:null}{authMode==='signin'?'Sign in':authMode==='register'?'Create account':'Send reset link'}<ArrowRight size={16}/></button></form><div className="auth-switch"><button className="text-button" onClick={()=>{setAuthMode(authMode==='signin'?'register':'signin');setAuthMessage('');setPassword('')}}>{authMode==='signin'?'Create an account':'Back to sign in'}</button>{authMode==='signin'&&<button className="text-button" onClick={()=>{setAuthMode('reset');setAuthMessage('');setPassword('')}}>Forgot password?</button>}</div></Modal>}
  {toDelete&&<Modal title="Remove this dish?" onClose={()=>setToDelete(null)}><p className="modal-copy muted">Remove “{toDelete.name}” from your shot list? Download its image first if you want to keep it. Credits already used are not returned.</p><div className="modal-actions"><button className="button button-secondary" disabled={busy} onClick={()=>setToDelete(null)}>Keep dish</button><button className="button button-danger" disabled={busy} onClick={deleteDish}><Trash2 size={15}/>Remove dish</button></div></Modal>}
  {preview&&<Modal title={preview.name} wide onClose={()=>setPreview(null)}><div className="preview-image"><img src={preview.imageUrl} alt={LIVE?`Preview for ${preview.name}`:demoPhotoAlt(preview)}/></div><div className="preview-footer"><div><strong>{preview.styleConfig?.style} · {preview.styleConfig?.size}</strong><p>{LIVE?'Studio image':`AI-generated with ChatGPT · Pre-generated sample${preview.demoImage?.representative?` of ${preview.demoImage.subject}`:''}`}</p>{!LIVE&&<p>{preview.demoImage?.representative?'Representative image; not a depiction of your custom dish. ':''}{preview.styleConfig?.size==='1K'?'1024 × 1024 PNG export.':`${DEMO_EXPORT_SIZES[preview.styleConfig?.size||'1K']} × ${DEMO_EXPORT_SIZES[preview.styleConfig?.size||'1K']} PNG export, upscaled from 1024 × 1024.`}</p>}</div><button className="button button-primary" disabled={downloadBusy} onClick={()=>void download(preview)}>{downloadBusy?<Loader2 size={16} className="spin"/>:<Download size={16}/>}{LIVE?'Download image':'Download PNG'}</button></div></Modal>}
 </>;
}
