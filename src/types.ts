export type PhotoStyle = 'Rustic/Dark' | 'Bright/Modern' | 'Social Media';
export type ImageSize = '1K' | '2K' | '4K';
export interface GenerationConfig { style: PhotoStyle; size: ImageSize }
export interface Dish { id: string; name: string; description: string; status: 'pending'|'generating'|'completed'|'error'; imageUrl?: string; error?: string; styleConfig?: GenerationConfig; lastCost?: number }
export interface User { id: string; email: string; name: string; credits: number; role: 'user'|'admin' }
export interface CreditPackage {id:string;label:string;credits:number;amount:number;currency:string}
export interface StudioApi {
  me():Promise<User>;
  dishes():Promise<Dish[]>;
  parse(text:string, requestId:string):Promise<Dish[]>;
  generate(id:string,config:GenerationConfig,requestId:string):Promise<{dish:Dish;credits:number}>;
  remove(id:string):Promise<void>;
  catalog():Promise<{packages:CreditPackage[];enabled:boolean}>;
  checkout(packageId:string,requestId:string):Promise<string>;
  reset?():Promise<void>;
}
export const COST:Record<ImageSize,number>={'1K':1,'2K':2,'4K':4};
export const DEMO_MENU = 'Lemon & herb pasta — Ribbon pasta, garden herbs, lemon zest and parmesan\nRoasted harvest bowl — Roasted sweet potato, grains, crisp greens and tahini dressing\nCitrus-glazed salmon — Pan-seared salmon, charred lemon and seasonal greens';
