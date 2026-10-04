import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const refs=JSON.parse(await readFile('/tmp/sessionweave-model-check-refs.json','utf8'));
const browser=await chromium.launch({args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1512,height:982}});
const errors=[],modelWrites=[];let dispatches=0,successfulModelWrites=0;
page.on('response',r=>{if(new URL(r.url()).pathname==='/api/model'&&r.ok())successfulModelWrites++;});
page.on('pageerror',e=>errors.push(e.message));
page.on('request',r=>{const path=new URL(r.url()).pathname;if(r.method()==='POST'&&path==='/api/runs')dispatches++;if(r.method()==='POST'&&path==='/api/model')modelWrites.push(r.postDataJSON());});
const width=selector=>page.locator(selector).evaluate(el=>Math.round(el.getBoundingClientRect().width));
async function drag(handle,dx){const b=await handle.boundingBox();await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.mouse.move(b.x+dx,b.y+b.height/2,{steps:12});await page.mouse.up();}

async function slideTo(label){
  const slider=page.getByRole('slider',{name:'模型思考档位'}),ticks=await page.locator('.effort-ticks button').allTextContents();
  const index=ticks.indexOf(label);assert.ok(index>=0,`Native effort ${label} must be present`);
  const b=await slider.boundingBox(),max=Number(await slider.getAttribute('max')),current=Number(await slider.inputValue());
  const x=value=>b.x+7.5+(b.width-15)*value/max;
  await page.mouse.move(x(current),b.y+b.height/2);await page.mouse.down();await page.mouse.move(x(index),b.y+b.height/2,{steps:8});await page.mouse.up();
  assert.equal(Number(await slider.inputValue()),index);assert.equal(await slider.getAttribute('aria-valuetext'),label);
}
async function dismiss(){await page.locator('.canvas-toolbar .eyebrow').click();await page.getByRole('region',{name:'模型选择下拉'}).waitFor({state:'hidden'});}
try{
  await page.goto(process.env.DEMO_URL||'http://127.0.0.1:8787');
  await page.getByLabel('搜索会话',{exact:true}).fill('模型选择核验');
  await page.getByLabel('时间范围',{exact:true}).selectOption('all');
  const resourceA=page.locator('.session-item').filter({hasText:refs.a.title}),resourceB=page.locator('.session-item').filter({hasText:refs.b.title});
  await resourceA.waitFor();await resourceB.waitFor();
  const left=page.getByRole('separator',{name:'调整会话区宽度'}),right=page.getByRole('separator',{name:'调整计划区宽度'});
  await drag(left,2000);assert.equal(await width('.sessions-panel'),420);
  await drag(right,-2000);assert.equal(await width('.plan-panel'),520);assert.ok(await width('.center-panel')>=480);
  await left.focus();await left.press('Home');assert.equal(await width('.sessions-panel'),220);
  await right.focus();await right.press('Home');assert.equal(await width('.plan-panel'),280);
  await left.press('ArrowRight');assert.equal(await width('.sessions-panel'),230);
  await page.reload();assert.equal(await width('.sessions-panel'),230);assert.equal(await width('.plan-panel'),280);
  await page.setViewportSize({width:1100,height:900});await page.waitForTimeout(200);assert.ok(await width('.center-panel')>=480);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.setViewportSize({width:1512,height:982});await left.dblclick();await right.dblclick();assert.equal(await width('.sessions-panel'),278);assert.equal(await width('.plan-panel'),345);
  await page.getByLabel('搜索会话',{exact:true}).fill('模型选择核验');await page.getByLabel('时间范围',{exact:true}).selectOption('all');
  await resourceA.getByRole('button',{name:`添加步骤 ${refs.a.title}`,exact:true}).click();
  await page.locator('.model-picker-trigger').filter({hasText:'Space Bunny Free'}).waitFor();
  assert.ok(await page.locator('.model-picker-trigger').innerText().then(s=>s.includes('Low')));
  await page.locator('.model-picker-trigger').click();await page.getByRole('region',{name:'模型选择下拉'}).waitFor();
  await page.getByLabel('搜索模型或提供商').fill('Ling 3.1 Flash');
  await page.locator('.model-options button').filter({hasText:'inclusionai/ling-3.1-flash'}).click();
  assert.equal(await page.getByRole('dialog').count(),0);assert.equal(await page.locator('.modal-backdrop').count(),0);assert.equal(modelWrites.length,0);await slideTo('Thinking');assert.equal(modelWrites.length,0);await dismiss();
  await page.locator('.model-picker-trigger').filter({hasText:'Ling 3.1 Flash'}).waitFor();
  await page.locator('.model-picker-trigger').click();await page.getByLabel('搜索模型或提供商').fill('space-bunny-free');
  await page.locator('.model-options button').filter({hasText:'space-bunny-free'}).click();assert.ok((await page.locator('.effort-ticks').innerText()).includes('Max'));assert.ok(!(await page.locator('.effort-ticks').innerText()).includes('Fast'));await slideTo('Low');assert.equal(modelWrites.length,1);await dismiss();
  await page.locator('.model-picker-trigger').filter({hasText:'Space Bunny Free'}).waitFor();
  const editor=page.locator('.cm-content');await editor.click();await editor.press('Control+a');await editor.press('Backspace');await editor.pressSequentially('$');
  await page.locator('.cm-tooltip-autocomplete').waitFor();assert.ok((await page.locator('.cm-tooltip-autocomplete').innerText()).includes('$'));
  await page.waitForTimeout(150);await editor.press('ArrowDown');assert.equal(await page.locator('.cm-tooltip-autocomplete').count(),1);await editor.press('Enter');assert.ok((await editor.innerText()).startsWith('$'));await page.waitForFunction(()=>document.querySelectorAll('.editor-resources .check-row input:checked').length>0);
  await editor.press('Control+a');await editor.press('Backspace');await editor.pressSequentially('/model');await page.locator('.cm-tooltip-autocomplete').waitFor();await page.waitForTimeout(150);await editor.press('Enter');
  await page.getByRole('region',{name:'模型选择下拉'}).waitFor();assert.equal(await editor.locator('.cm-placeholder').count(),1);await dismiss();
  await resourceB.getByRole('button',{name:`添加步骤 ${refs.b.title}`,exact:true}).click();
  await page.locator('.model-picker-trigger').filter({hasText:'GPT-6-Luna'}).waitFor();assert.equal(await page.getByRole('dialog').count(),0);
  let delayOneRead=true;
  await page.route('**/api/models',async route=>{if(delayOneRead&&route.request().postDataJSON()?.harness==='codex'){delayOneRead=false;const response=await route.fetch();await new Promise(r=>setTimeout(r,600));await route.fulfill({response});}else await route.continue();});
  await page.locator('.model-picker-trigger').click();await page.getByLabel('搜索模型或提供商').fill('gpt-6-luna');await page.locator('.model-options button').filter({hasText:'gpt-6-luna'}).click();
  assert.ok(!(await page.locator('.effort-ticks').innerText()).includes('Ultra'));
  await slideTo('Medium');assert.equal(modelWrites.length,2);assert.equal(await page.getByRole('region',{name:'模型选择下拉'}).isVisible(),true);
  await page.route('**/api/model',route=>route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:'模拟模型保存失败，请重试'})}),{times:1});
  await page.locator('.canvas-toolbar .eyebrow').click();await page.getByRole('alert').filter({hasText:'模拟模型保存失败'}).waitFor();
  assert.equal(await page.getByRole('region',{name:'模型选择下拉'}).isVisible(),true);assert.equal(await page.getByRole('slider').getAttribute('aria-valuetext'),'Medium');
  await dismiss();await page.waitForFunction(()=>document.querySelector('.model-picker-trigger')?.textContent.includes('Medium'));
  await page.waitForTimeout(700);assert.ok((await page.locator('.model-picker-trigger').innerText()).includes('Medium'));await page.unroute('**/api/models');
  await page.locator('.model-picker-trigger').click();await slideTo('Low');await dismiss();await page.waitForFunction(()=>document.querySelector('.model-picker-trigger')?.textContent.includes('Low'));
  await page.evaluate(()=>document.fonts.ready);assert.ok(await page.evaluate(()=>document.fonts.check('14px "Geist Variable"')&&document.fonts.check('14px "Noto Sans SC Variable"','会话')));
  await mkdir('docs/evidence',{recursive:true});await page.screenshot({path:'docs/evidence/分栏与模型调整.png'});
  await page.locator('.model-picker-trigger').click();await page.screenshot({path:'docs/evidence/原生模型选择器.png'});await dismiss();
  await page.setViewportSize({width:390,height:844});assert.equal(await left.isVisible(),false);await page.getByLabel('会话列表',{exact:true}).click();assert.equal(await page.locator('.sessions-panel').isVisible(),true);await page.getByLabel('会话列表',{exact:true}).click();await page.getByLabel('计划面板',{exact:true}).click();assert.equal(await page.locator('.plan-panel').isVisible(),true);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.equal(dispatches,0);assert.equal(modelWrites.length,5);assert.equal(successfulModelWrites,4);assert.ok(modelWrites.every(m=>m.id===refs.a.id||m.id===refs.b.id));assert.deepEqual(errors,[]);
  const report={passed:true,checks:['模型选择为锚定下拉而非模态窗口','点选模型和拖动滑槽保持展开且不提前发送','点击外部应用并回读模型配置','滑槽档位按模型原生目录变化且不虚构Fast/Ultra','保存失败保留面板和选择且可重试','两侧拖拽上下限','中心最小宽度','键盘调整与双击重置','刷新记忆宽度','1100px与390px布局','OpenCode提供商/模型/variant原生切换回读','Codex模型/effort原生切换回读','延迟配置读取不覆盖用户选择和已应用结果','$补全保留前缀并选择原生Skill','补全菜单方向键不误调用历史','/model打开选择器且不发送','切换节点不误打开模型弹窗','本地字体加载'],successfulModelWrites,simulatedSaveFailures:1,modelWrites:modelWrites.map(m=>({harness:m.harness,selection:m.selection})),businessRunRequests:dispatches,pageErrors:errors};
  await writeFile('docs/evidence/分栏与模型验收.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{await browser.close();}
