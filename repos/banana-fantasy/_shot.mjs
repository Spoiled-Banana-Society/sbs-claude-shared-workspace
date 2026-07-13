import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await (await b.newContext({ viewport:{width:980,height:520}, deviceScaleFactor:2 })).newPage();
await p.goto('http://localhost:3000/badge-sizes',{waitUntil:'domcontentloaded'});
await p.waitForTimeout(4000);
for(let i=0;i<6;i++){const s=p.locator('text=Skip').first();if((await s.count())&&await s.isVisible().catch(()=>false)){await s.click({force:true}).catch(()=>{});await p.waitForTimeout(400);}else break;}
await p.evaluate(()=>{for(const el of Array.from(document.querySelectorAll('body *'))){const s=getComputedStyle(el);if(s.position==='fixed'&&el.getBoundingClientRect().height>window.innerHeight*0.6&&/Evolved|Skip/.test(el.textContent||''))el.remove();}}).catch(()=>{});
await p.waitForTimeout(500);
await p.screenshot({path:'/tmp/bg2.png',fullPage:true}); console.log('done'); await b.close();
