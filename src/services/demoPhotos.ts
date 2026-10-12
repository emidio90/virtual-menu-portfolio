import { DEMO_DISHES, type Dish, type PhotoStyle } from '../types.ts';

const styles:Record<PhotoStyle,string>={
 'Rustic/Dark':'rustic',
 'Bright/Modern':'modern',
 'Social Media':'social',
};
export const DEMO_PHOTO_SIZE=1024;
export const DEMO_EXPORT_SIZES={'1K':1024,'2K':2048,'4K':4096} as const;

export function demoPhotoUrl(subject:typeof DEMO_DISHES[number]['key'],style:PhotoStyle):string {
 return `/fixtures/${subject}-${styles[style]}.webp`;
}

// The browser chooses a bundled sample; it never synthesizes a dish from input.
// Even a matching dish name remains representative if its description differs.
export function selectDemoPhoto(dish:Pick<Dish,'name'|'description'>,style:PhotoStyle):Pick<Dish,'imageUrl'|'demoImage'> {
 const normalize=(value:string)=>value.trim().toLowerCase().replace(/\s+/g,' ');
 const exact=DEMO_DISHES.find(sample=>normalize(sample.name)===normalize(dish.name)&&normalize(sample.description)===normalize(dish.description));
 const name=normalize(dish.name);
 const index=/\b(?:salmon|fish|seafood)\b/.test(name)?2:/\b(?:bowl|salad|grain|grains|vegetable|vegetables)\b/.test(name)?1:0;
 const sample=exact??DEMO_DISHES[index];
 return {imageUrl:demoPhotoUrl(sample.key,style),demoImage:{subject:sample.name,representative:!exact,sourceSize:DEMO_PHOTO_SIZE}};
}

export function demoPhotoAlt(dish:Dish):string {
 const subject=dish.demoImage?.subject||'a sample dish';
 return `AI-generated sample of ${subject}${dish.demoImage?.representative?`; representative preview, not a depiction of ${dish.name}`:''}`;
}
