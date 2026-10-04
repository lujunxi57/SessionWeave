import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OpenCodeAdapter } from '../server/opencode';
import { CodexAdapter } from '../server/codex';

test('OpenCode business dispatch inherits the TUI model without switching or injecting a model',async()=>{
  const adapter=new OpenCodeAdapter();const selected={id:'native/model',providerID:'provider',variant:'thinking'};let submitted:any;
  adapter.events=async()=>{};adapter.resources=async()=>({skills:[],commands:[]});
  adapter.api=async()=>({session:{active:async()=>({}),get:async()=>({model:selected}),switchModel:async()=>{assert.fail('dispatch must not override the user model');},prompt:async(input:any)=>{submitted=input;return{id:'accepted'};}}}) as any;
  (adapter as any).wait=async()=>({id:'accepted',text:'done',model:'provider/native/model',effort:'thinking'});
  const result=await adapter.send('session','task',[],[],()=>{});
  assert.equal('model' in submitted,false);assert.equal(result.model,'provider/native/model');assert.equal(submitted.delivery,'queue');
});
test('new OpenCode sessions use native presets; helper and test presets remain explicit',async()=>{
  const adapter=new OpenCodeAdapter(),inputs:any[]=[];
  adapter.api=async()=>({session:{create:async(input:any)=>{inputs.push(input);return{...input,id:'new',location:{directory:'/tmp'},time:{updated:1}};}}}) as any;
  await adapter.create('business');await adapter.create('test',true);await adapter.create('helper',false,{id:'space-bunny-free',providerID:'opencode',effort:'default'});
  assert.equal('model' in inputs[0],false);assert.equal(inputs[1].model.variant,'low');assert.equal(inputs[2].model.id,'space-bunny-free');assert.equal('variant' in inputs[2].model,false);
});
test('OpenCode catalog handles provider collisions and excludes native secrets',async()=>{
  const adapter=new OpenCodeAdapter();let model={id:'same',providerID:'one',variant:'low'};let active=false;let switches=0;
  adapter.api=async()=>({session:{get:async()=>({id:'s',model,location:{directory:'/tmp'},time:{updated:1}}),active:async()=>active?{s:{}}:{},switchModel:async(input:any)=>{switches++;model={...input.model,variant:input.model.variant||'default'};}},provider:{list:async()=>({data:[{id:'one',name:'One',password:'secret'},{id:'two',name:'Two'}]})},model:{list:async()=>({data:['one','two'].map(providerID=>({id:'same',name:'Same',providerID,enabled:true,status:'active',settings:{apiKey:'secret'},variants:[{id:'low',settings:{headers:{Authorization:'secret'}}}]}))})}}) as any;
  const catalog=await adapter.models('s');assert.equal(catalog.models.length,2);assert.ok(!JSON.stringify(catalog).includes('secret'));
  await assert.rejects(adapter.setModel('s',{id:'same',providerID:'two',effort:'high'}),/不支持/);assert.equal(switches,0);
  const updated=await adapter.setModel('s',{id:'same',providerID:'two',effort:'default'});assert.equal(updated.current.providerID,'two');assert.equal(updated.current.effort,'default');
  active=true;await assert.rejects(adapter.setModel('s',{id:'same',providerID:'one',effort:'low'}),/正在运行/);assert.equal(switches,1);
});
test('Codex picker reads presets without resuming or mutating a historical conversation',async()=>{
  const adapter=new CodexAdapter('/unused'),calls:string[]=[];adapter.rpc.connect=async()=>{};
  adapter.rpc.request=async(method:string)=>{calls.push(method);if(method==='thread/read')return{thread:{id:'s',cwd:'/tmp',status:{type:'notLoaded'},updatedAt:1}};if(method==='model/list')return{data:[{model:'native-default',displayName:'Native',supportedReasoningEfforts:[{reasoningEffort:'low'}],defaultReasoningEffort:'low'}],nextCursor:null};if(method==='config/read')return{config:{model:'native-default',model_reasoning_effort:'low'}};assert.fail(`Unexpected mutation ${method}`);};
  const result=await adapter.models('s');assert.equal(result.current.id,'native-default');assert.equal(result.source,'preset');assert.deepEqual(calls,['thread/read','model/list','config/read']);
});
test('Codex unset configuration uses the native isDefault marker rather than catalog order',async()=>{
  const adapter=new CodexAdapter('/unused');adapter.rpc.connect=async()=>{};
  adapter.rpc.request=async(method:string)=>method==='thread/read'?{thread:{id:'s',cwd:'/tmp',status:{type:'notLoaded'},updatedAt:1}}:method==='config/read'?{config:{model:null,model_reasoning_effort:null}}:{data:[{model:'first',displayName:'First',supportedReasoningEfforts:[{reasoningEffort:'low'}],defaultReasoningEffort:'low',isDefault:false},{model:'native-default',displayName:'Native default',supportedReasoningEfforts:[{reasoningEffort:'medium'}],defaultReasoningEffort:'medium',isDefault:true}],nextCursor:null};
  const result=await adapter.models('s');assert.deepEqual(result.current,{id:'native-default',effort:'medium'});
});
test('switching an already loaded empty Codex thread does not require a nonexistent rollout',async()=>{
  const adapter=new CodexAdapter('/unused');let effort='low';adapter.rpc.connect=async()=>{};
  adapter.rpc.request=async(method:string,params:any)=>{
    if(method==='thread/read')return{thread:{id:'s',cwd:'/tmp',status:{type:'idle'},model:'gpt-6-luna',reasoningEffort:effort,updatedAt:1}};
    if(method==='model/list')return{data:[{model:'gpt-6-luna',displayName:'Luna',supportedReasoningEfforts:[{reasoningEffort:'low'},{reasoningEffort:'medium'}],defaultReasoningEffort:'medium'}],nextCursor:null};
    if(method==='thread/settings/update'){effort=params.effort;return{};}
    assert.fail(`Empty loaded thread must not resume: ${method}`);
  };
  const result=await adapter.setModel('s',{id:'gpt-6-luna',effort:'medium'});assert.equal(result.current.effort,'medium');
});
