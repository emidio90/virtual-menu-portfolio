import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { DEMO_DISHES } from '../src/types.ts';
import { createDemoApi } from '../src/services/demo.ts';
import { DEMO_EXPORT_SIZES, DEMO_PHOTO_SIZE, demoPhotoAlt, demoPhotoUrl, selectDemoPhoto } from '../src/services/demoPhotos.ts';

const styles=['Rustic/Dark','Bright/Modern','Social Media'];

test('all three dishes have three distinct, local photo styles',()=>{
 const urls=DEMO_DISHES.flatMap(dish=>styles.map(style=>demoPhotoUrl(dish.key,style)));
 assert.equal(new Set(urls).size,9);
 for(const url of urls)assert.match(url,/^\/fixtures\/(pasta|bowl|salmon)-(rustic|modern|social)\.webp$/);
});

test('bundled photos are genuine 1024-square WebP files within the 250 kB budget',async()=>{
 const manifest=JSON.parse(await readFile(new URL('../docs/PHOTO_ASSETS.json',import.meta.url),'utf8'));
 assert.equal(manifest.runtimeGeneration,false);
 assert.equal(manifest.images.length,9);
 const hashes=new Set();
 for(const dish of DEMO_DISHES)for(const style of styles){
  const path=`public${demoPhotoUrl(dish.key,style)}`;
  const entry=manifest.images.find(image=>image.file===path);
  assert.ok(entry,`Missing provenance for ${path}`);
  const bytes=await readFile(new URL(`../${path}`,import.meta.url));
  assert.equal(bytes.toString('ascii',0,4),'RIFF');
  assert.equal(bytes.toString('ascii',8,16),'WEBPVP8 ');
  assert.equal(bytes.subarray(23,26).toString('hex'),'9d012a');
  assert.equal(bytes.readUInt16LE(26)&0x3fff,DEMO_PHOTO_SIZE);
  assert.equal(bytes.readUInt16LE(28)&0x3fff,DEMO_PHOTO_SIZE);
  assert.ok(bytes.length<250000,`${path} exceeds photo budget`);
  assert.equal(bytes.length,entry.bytes);
  const hash=createHash('sha256').update(bytes).digest('hex');
  assert.equal(hash,entry.sha256);hashes.add(hash);
 }
 assert.equal(hashes.size,9,'Each style is a distinct image, not a renamed duplicate');
});

test('exact synthetic menu samples identify their depicted subject',()=>{
 for(const dish of DEMO_DISHES)for(const style of styles){
  const image=selectDemoPhoto(dish,style);
  assert.equal(image.imageUrl,demoPhotoUrl(dish.key,style));
  assert.deepEqual(image.demoImage,{subject:dish.name,representative:false,sourceSize:1024});
 }
});

test('custom dishes, including matching names with altered ingredients, remain representative',()=>{
 for(const dish of [
  {name:'Pizza margherita',description:'Tomato and mozzarella'},
  {name:'Garden bowl',description:'Greens and grains'},
  {name:'Grilled salmon',description:'Rice and dill'},
  {...DEMO_DISHES[0],description:'Shrimp and chili pasta'},
 ]){
  const image=selectDemoPhoto(dish,'Rustic/Dark');
  assert.equal(image.demoImage.representative,true);
  const alt=demoPhotoAlt({...dish,...image});
  assert.match(alt,/AI-generated sample of/);
  assert.ok(alt.includes(`not a depiction of ${dish.name}`));
 }
});

test('custom names cannot become asset paths or external image requests',()=>{
 for(const name of ['https://example.invalid/image.jpg','../../private','<script>alert(1)</script>','Salad bowl']){
  const image=selectDemoPhoto({name,description:'Custom menu input'},'Social Media');
  assert.match(image.imageUrl,/^\/fixtures\/(pasta|bowl|salmon)-social\.webp$/);
  assert.equal(image.demoImage.representative,true);
 }
});

test('export sizes do not claim larger source images',()=>{
 assert.deepEqual(DEMO_EXPORT_SIZES,{'1K':1024,'2K':2048,'4K':4096});
 assert.equal(DEMO_PHOTO_SIZE,1024);
});

test('demo starts and resets with three pre-generated modern samples',async()=>{
 const api=createDemoApi();
 const initial=await api.dishes();
 assert.equal(initial.length,3);
 assert.ok(initial.every(dish=>dish.imageUrl.endsWith('-modern.webp')&&!dish.demoImage.representative));
 initial[0].demoImage.subject='Changed outside adapter';
 assert.equal((await api.dishes())[0].demoImage.subject,DEMO_DISHES[0].name);
 await api.remove(initial[0].id);
 await api.reset();
 assert.equal((await api.dishes()).length,3);
 assert.equal((await api.me()).credits,12);
 await assert.rejects(api.checkout('unused','unused'),/Payments are disabled/);
});

test('demo generation selects existing styles and preserves representative metadata on retry',async()=>{
 const api=createDemoApi();
 const [dish]=await api.parse('Pizza margherita — Tomato and mozzarella','parse-photo-test');
 assert.equal(dish.imageUrl,undefined);
 const config={style:'Social Media',size:'4K'};
 const generated=await api.generate(dish.id,config,'photo-test');
 assert.equal(generated.dish.imageUrl,'/fixtures/pasta-social.webp');
 assert.equal(generated.dish.demoImage.representative,true);
 assert.equal(generated.dish.demoImage.subject,'Lemon & herb pasta');
 assert.equal(generated.dish.demoImage.sourceSize,1024);
 assert.equal(generated.credits,8);
 assert.deepEqual(await api.generate(dish.id,config,'photo-test'),generated);
 assert.equal((await api.me()).credits,8);
});
