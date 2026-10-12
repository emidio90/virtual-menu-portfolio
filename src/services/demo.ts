import pasta from '../assets/pasta.svg?raw';
import bowl from '../assets/bowl.svg?raw';
import salmon from '../assets/salmon.svg?raw';
import { COST, DEMO_MENU, type Dish, type GenerationConfig, type StudioApi, type User } from '../types';

const pause=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
const copy=<T,>(data:T):T=>structuredClone(data);
const illustrations=[pasta,bowl,salmon];
const config:GenerationConfig={style:'Bright/Modern',size:'1K'};
function fixture(name:string,style:GenerationConfig['style']):string {
  const n=name.toLowerCase();
  const index=/salmon|fish|seafood/.test(n)?2:/bowl|salad|grain|vegetable/.test(n)?1:0;
  const background=style==='Bright/Modern'?'#eee9df':style==='Social Media'?'#d8cbef':'#121922';
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(illustrations[index].replaceAll('#121922',background))}`;
}
function parseLines(text:string):Dish[] {
 const lines=text.split('\n').map(line=>line.trim().replace(/^(?:[-•*]|\d+[.)])\s+/, '')).filter(Boolean);
 if(lines.length>20)throw new Error('Use up to 20 dishes at a time, one dish per line.');
 return lines.map(line=>{
   const match=line.match(/^(.+?)\s*(?:[—–]|\s-\s|:)\s*(.+)$/);
   return {id:crypto.randomUUID(),name:(match?.[1]||line).slice(0,100),description:(match?.[2]||'Add your own menu description to explore this dish.').slice(0,500),status:'pending'};
 });
}
export function createDemoApi():StudioApi {
 let user:User={id:'demo-visitor',email:'',name:'Demo workspace',credits:12,role:'user'};
 let items:Dish[]=parseLines(DEMO_MENU).map(d=>({...d,status:'completed',styleConfig:config,imageUrl:fixture(d.name,config.style)}));
 const responses=new Map<string,unknown>();
 const active=new Set<string>();
 return {
   async me(){return copy(user)},
   async dishes(){return copy(items)},
   async parse(text,requestId){
     if(responses.has(requestId))return copy(responses.get(requestId) as Dish[]);
     const parsed=parseLines(text);if(!parsed.length)throw new Error('Add at least one dish, one per line.');
     await pause(450);items=[...parsed,...items];responses.set(requestId,parsed);return copy(parsed);
   },
   async generate(id,nextConfig,requestId){
     if(responses.has(requestId))return copy(responses.get(requestId) as {dish:Dish;credits:number});
     const dish=items.find(item=>item.id===id);if(!dish)throw new Error('This dish is no longer in your workspace.');
     if(active.has(id))throw new Error('This dish is already being prepared.');
     const cost=COST[nextConfig.size];if(user.credits<cost)throw new Error('Not enough demo credits. Reset your workspace to try again.');
     active.add(id);user.credits-=cost;dish.status='generating';
     await pause(950);
     dish.status='completed';dish.imageUrl=fixture(dish.name,nextConfig.style);dish.styleConfig=copy(nextConfig);dish.lastCost=cost;delete dish.error;
     const result={dish:copy(dish),credits:user.credits};responses.set(requestId,result);active.delete(id);return copy(result);
   },
   async remove(id){if(active.has(id))throw new Error('Please wait for the current preview to finish.');items=items.filter(d=>d.id!==id)},
   async catalog(){return {packages:[],enabled:false}},
   async checkout(){throw new Error('Payments are disabled in the illustrated demo.')},
   async reset(){items=parseLines(DEMO_MENU).map(d=>({...d,status:'completed',styleConfig:config,imageUrl:fixture(d.name,config.style)}));user={...user,credits:12};responses.clear();active.clear()},
 };
}
