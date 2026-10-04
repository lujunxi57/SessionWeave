import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { validateWorkflow, renderPrompt } from '../shared/workflow';
import { Engine } from '../server/engine';
import { openCodeSnapshot } from '../server/opencode';
import { codexFinalText, CodexAdapter } from '../server/codex';
import type { Conversation, HarnessAdapter, Workflow } from '../shared/types';
const sessions:Conversation[]=[{id:'a',harness:'opencode',title:'A',preview:'',cwd:'/tmp',updatedAt:1,state:'idle'},{id:'b',harness:'codex',title:'B',preview:'',cwd:'/tmp',updatedAt:1,state:'idle'}];
function loop():Workflow{return {id:'loop',name:'test',nodes:['A1','B','A3'].map((id,i)=>({id,conversationRef:{harness:i===1?'codex':'opencode',id:i===1?'b':'a'},purpose:id,mode:'kickoff',promptTemplate:i?'review':'research',selectedSkills:[],selectedFiles:[],upstreamOutputRefs:i?[i===1?'A1':'B']:[],polishBeforeSend:false,position:{x:i,y:0}})),edges:[{id:'ab',source:'A1',target:'B'},{id:'ba',source:'B',target:'A3'}]};}
test('A1 and A3 share a conversation but are distinct steps; actual graph cycles are rejected',()=>{assert.equal(validateWorkflow(loop(),sessions).nodes.length,3);const w=loop();w.edges.push({id:'cycle',source:'A3',target:'A1'});assert.throws(()=>validateWorkflow(w,sessions),/环/);});
test('references cannot point to a future step or fabricate a session',()=>{const w=loop();w.nodes[0].upstreamOutputRefs=['B'];assert.throws(()=>validateWorkflow(w,sessions),/上游/);const unknown=loop();unknown.nodes[0].conversationRef.id='fake';assert.throws(()=>validateWorkflow(unknown,sessions),/会话不存在/);});
test('upstream snapshots remain literal and are not recursively evaluated as template tokens',()=>{const text=renderPrompt('read {{A.output}}',['A','B'],new Map([['A','literal {{B.output}}'],['B','second']]));assert.ok(text.includes('literal {{B.output}}'));assert.ok(text.endsWith('second\n</upstream_output>'));assert.throws(()=>renderPrompt('read',['A'],new Map()),/没有完成快照/);});
test('OpenCode completion requires target input, native idle success, and final assistant text',()=>{const data=[{id:'old',type:'assistant',content:[{type:'text',text:'stale'}]},{id:'user',type:'user'},{id:'tool',type:'assistant',finish:'tool-calls',content:[{type:'text',text:'tool commentary'}]},{id:'final',type:'assistant',finish:'stop',model:{providerID:'opencode',id:'space-bunny-free',variant:'default'},content:[{type:'text',text:'final'},{type:'reasoning',text:'secret reasoning'}]}];assert.equal(openCodeSnapshot(data,'user'),null);assert.equal(openCodeSnapshot([...data,{type:'idle',outcome:'succeeded'}],'user')?.text,'final');assert.equal(openCodeSnapshot(data,'missing'),null);assert.throws(()=>openCodeSnapshot([...data,{type:'user',id:'foreign'},{type:'idle',outcome:'succeeded'}],'user'),/另一客户端/);assert.throws(()=>openCodeSnapshot([...data,{type:'idle',outcome:'failed'}],'user'),/failed/);});
test('Codex output excludes commentary and tools when a final answer phase is available',()=>{assert.equal(codexFinalText([{type:'agentMessage',text:'working',phase:'commentary'},{type:'commandExecution',aggregatedOutput:'tool output'},{type:'agentMessage',text:'answer',phase:'final_answer'}]),'answer');});
test('a transient interrupted history projection cannot fail a live Codex turn before its native terminal event',async()=>{
  const adapter=new CodexAdapter('/unused');
  adapter.rpc.connect=async()=>{};
  adapter.rpc.request=async(method:string)=>method==='thread/read'?{thread:{status:{type:'active'},model:'existing-model'}}:method==='thread/items/list'?{data:[{item:{id:'final',type:'agentMessage',phase:'final_answer',text:'actual final'}}],nextCursor:null}:{data:[{id:'turn',status:'interrupted',completedAt:null}]};
  const timer=setTimeout(()=>adapter.rpc.emit('notification',{method:'turn/completed',params:{threadId:'thread',turn:{id:'turn',status:'completed',completedAt:1}}}),20);
  const result=await (adapter as any).wait('thread','turn',()=>{});clearTimeout(timer);assert.equal(result.text,'actual final');assert.equal(result.id,'turn');
});
test('pause stops downstream dispatch, retains the in-flight output, then resumes A → B → A',async()=>{
  let release!:()=>void;const blocked=new Promise<void>(r=>release=r);const sent:string[]=[];
  const adapter:HarnessAdapter={list:async()=>sessions,create:async()=>sessions[0],resources:async()=>({skills:[],commands:[]}),listen:async()=>({id:'listen',text:'listened'}),send:async(id,text,_s,_f,update)=>{sent.push(id);update({state:'running',text:'working',nativeId:String(sent.length)});if(sent.length===1)await blocked;return{id:String(sent.length),text:`output-${sent.length}`};}};
  const engine=new Engine({codex:adapter,opencode:adapter},await mkdtemp(`${tmpdir()}/sessionweave-test-`));await engine.initialize();const run=await engine.start(loop(),sessions);
  while(!sent.length)await new Promise(r=>setTimeout(r,5));await engine.pause(run.id,true);release();
  while(run.nodes[0].state!=='succeeded')await new Promise(r=>setTimeout(r,5));await new Promise(r=>setTimeout(r,30));assert.deepEqual(sent,['a']);assert.equal(run.nodes[0].outputSnapshot,'output-1');assert.equal(run.state,'paused');
  await engine.pause(run.id,false);while(!['succeeded','failed'].includes(run.state))await new Promise(r=>setTimeout(r,5));assert.deepEqual(sent,['a','b','a']);assert.equal(run.state,'succeeded');assert.ok(run.nodes[1].actualSentPrompt?.includes('output-1'));assert.ok(run.nodes[2].actualSentPrompt?.includes('output-2'));
});
test('a failed upstream stops the run and marks downstream as undispatched',async()=>{
  const sent:string[]=[];
  const adapter:HarnessAdapter={list:async()=>sessions,create:async()=>sessions[0],resources:async()=>({skills:[],commands:[]}),listen:async()=>{throw new Error('unused');},send:async(id)=>{sent.push(id);throw new Error('native turn failed');}};
  const engine=new Engine({codex:adapter,opencode:adapter},await mkdtemp(`${tmpdir()}/sessionweave-failure-`));await engine.initialize();const run=await engine.start(loop(),sessions);
  while(run.state==='running')await new Promise(r=>setTimeout(r,5));
  assert.equal(run.state,'failed');assert.deepEqual(sent,['a']);assert.equal(run.nodes[0].error,'native turn failed');assert.ok(run.nodes.slice(1).every(n=>n.state==='failed'&&n.error==='上游步骤失败，未派发'&&!n.nativeTurnOrMessageId));
});
test('two runs sharing a conversation wait in FIFO order without overlapping dispatch',async()=>{
  let release!:()=>void;const blocked=new Promise<void>(r=>release=r);const sent:string[]=[];let active=0,maxActive=0;
  const adapter:HarnessAdapter={list:async()=>sessions,create:async()=>sessions[0],resources:async()=>({skills:[],commands:[]}),listen:async()=>{throw new Error('unused');},send:async(_id,text)=>{sent.push(text);maxActive=Math.max(maxActive,++active);if(sent.length===1)await blocked;active--;return{id:String(sent.length),text:'done'};}};
  const engine=new Engine({codex:adapter,opencode:adapter},await mkdtemp(`${tmpdir()}/sessionweave-fifo-`));await engine.initialize();
  function single(text:string){const w=loop();w.nodes=w.nodes.slice(0,1);w.nodes[0].promptTemplate=text;w.edges=[];return w;}
  const first=await engine.start(single('first'),sessions);while(!sent.length)await new Promise(r=>setTimeout(r,5));const second=await engine.start(single('second'),sessions);await new Promise(r=>setTimeout(r,25));assert.deepEqual(sent,['first']);release();
  while(first.state==='running'||second.state==='running')await new Promise(r=>setTimeout(r,5));assert.deepEqual(sent,['first','second']);assert.equal(maxActive,1);assert.equal(first.state,'succeeded');assert.equal(second.state,'succeeded');
});
