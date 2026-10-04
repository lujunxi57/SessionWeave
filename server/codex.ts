import { randomUUID } from 'node:crypto';
import { CodexRpc } from './rpc';
import type { Activity, Conversation, HarnessAdapter, ModelCatalog, ModelOption, ModelSelection, NativeResult } from '../shared/types';
const sleep = (ms: number) => new Promise(r => setTimeout(r,ms));
export function codexFinalText(items: any[]) {
  const messages = items.filter(i => i.type === 'agentMessage');
  const finals = messages.filter(i => i.phase === 'final_answer');
  return (finals.length ? finals : messages.slice(-1)).map(i => i.text || '').join('\n\n');
}
export class CodexAdapter implements HarnessAdapter {
  readonly rpc: CodexRpc;
  private notifications = new Map<string, any>();
  private completedItems = new Map<string, Map<string,any>>();
  private threadSettings = new Map<string, any>();
  readonly approvals = new Map<string, any>();
  private attached = new Set<string>();
  constructor(socketPath: string) {
    this.rpc = new CodexRpc(socketPath);
    this.rpc.on('notification', m => {
      if (m.method === 'turn/completed') { this.notifications.set(`${m.params.threadId}:${m.params.turn.id}`, m.params.turn); if (this.notifications.size > 500) this.notifications.delete(this.notifications.keys().next().value!); }
      if (m.method === 'item/completed') { const key=`${m.params.threadId}:${m.params.turnId}`;const items=this.completedItems.get(key)||new Map();items.set(m.params.item.id,m.params.item);this.completedItems.set(key,items); }
      if (m.method === 'serverRequest/resolved') this.approvals.delete(String(m.params.requestId));
    });
    this.rpc.on('request', m => this.approvals.set(String(m.id), m));
    this.rpc.on('disconnected', () => this.attached.clear());
  }
  private normalize(t: any): Conversation {
    return { id: t.id, harness: 'codex', title: t.name || t.preview?.slice(0,70) || `Codex ${t.id.slice(0,8)}`, preview: t.preview || '', cwd: t.cwd,
      updatedAt: (t.recencyAt || t.updatedAt) * 1000, state: t.status?.type === 'active' ? 'running' : t.status?.type === 'notLoaded' ? 'unloaded' : t.status?.type === 'systemError' ? 'unavailable' : 'idle',
      model: t.model || undefined, effort: t.reasoningEffort || undefined, loaded: t.status?.type !== 'notLoaded', canSend: t.canAcceptDirectInput !== false,testing:t.name?.startsWith('SessionWeave test · ') };
  }
  async list() {
    await this.rpc.connect(); const list: Conversation[] = []; let cursor: string | null = null;
    do { const page = await this.rpc.request('thread/list', { limit:100, sortKey:'updated_at', useStateDbOnly:true, ...(cursor ? {cursor} : {}) }); list.push(...page.data.map((t: any) => this.normalize(t))); cursor = page.nextCursor; } while(cursor);
    const loaded=new Set<string>();cursor=null;
    do{const page=await this.rpc.request('thread/loaded/list',{limit:100,...(cursor?{cursor}:{})});page.data.forEach((id:string)=>loaded.add(id));cursor=page.nextCursor;}while(cursor);
    // Empty new threads are not indexed as historical conversations yet. Merge
    // loaded native resources, using the actual thread/start response only when
    // their first durable rollout has not been flushed.
    for(const id of loaded)if(!list.some(c=>c.id===id)){
      const thread=await this.read(id).catch(()=>this.threadSettings.get(id));
      if(thread)list.push(this.normalize(thread));
    }
    return list;
  }
  async create(title: string,testing=false) {
    await this.rpc.connect(); const started = await this.rpc.request('thread/start', { cwd: process.cwd(), experimentalRawEvents:false,...(testing?{model:'gpt-6-luna'}:{}) });
    const thread={...started.thread,model:started.thread.model||started.model,reasoningEffort:started.thread.reasoningEffort||started.reasoningEffort};
    this.attached.add(thread.id);
    this.threadSettings.set(thread.id,thread);
    if(testing){await this.rpc.request('thread/settings/update',{threadId:thread.id,model:'gpt-6-luna',effort:'low'});thread.model='gpt-6-luna';thread.reasoningEffort='low';}
    await this.rpc.request('thread/name/set', { threadId:thread.id, name:title }); thread.name = title;
    return this.normalize(thread);
  }
  async models(id:string):Promise<ModelCatalog> {
    const thread=await this.read(id),models:ModelOption[]=[];let cursor:string|null=null,defaultId:string|undefined;
    do{const page=await this.rpc.request('model/list',{limit:100,includeHidden:false,...(cursor?{cursor}:{})});defaultId=page.data.find((m:any)=>m.isDefault)?.model||defaultId;models.push(...page.data.map((m:any)=>({id:m.model,name:m.displayName,providerName:'Codex',efforts:m.supportedReasoningEfforts.map((e:any)=>e.reasoningEffort),defaultEffort:m.defaultReasoningEffort})));cursor=page.nextCursor;}while(cursor);
    const config=!thread.model||!thread.reasoningEffort?(await this.rpc.request('config/read',{cwd:thread.cwd,includeLayers:false})).config:null;
    const modelId=thread.model||config?.model||defaultId||'';
    const current={id:modelId,effort:thread.reasoningEffort||config?.model_reasoning_effort||models.find(m=>m.id===modelId)?.defaultEffort};
    return {models,current,conversation:{...this.normalize(thread),model:current.id,effort:current.effort},source:thread.model?'session':'preset'};
  }
  async setModel(id:string,selection:ModelSelection) {
    const catalog=await this.models(id),chosen=catalog.models.find(m=>m.id===selection.id);if(!chosen)throw new Error('模型不在当前 Codex 可用目录中');
    const effort=selection.effort||chosen.defaultEffort;if(!chosen.efforts.includes(effort))throw new Error('该模型不支持此思考档位');
    if(catalog.conversation.state==='running')throw new Error('会话正在运行，结束后再切换模型');
    // Loaded CLI threads already exist in the shared server. Resuming a new
    // empty thread requires a rollout that does not exist until its first turn.
    const thread=catalog.conversation.state==='unloaded'?await this.attach(id):await this.read(id);
    if(thread.status?.type==='active')throw new Error('会话正在运行，结束后再切换模型');
    await this.rpc.request('thread/settings/update',{threadId:id,model:chosen.id,effort});
    const result=await this.models(id);if(result.current.id!==chosen.id||result.current.effort!==effort)throw new Error('模型切换回读不一致，请刷新会话配置');
    return result;
  }
  async resources(id: string) {
    await this.rpc.connect(); const { thread } = await this.rpc.request('thread/read', { threadId:id, includeTurns:false });
    const result = await this.rpc.request('skills/list', { cwds:[thread.cwd] });
    const skills = (result.data || []).flatMap((x: any) => x.skills || []).filter((s: any) => s.enabled !== false).map((s: any) => ({ id:s.path, name:s.name, description:s.description, path:s.path }));
    return { skills, commands: [] }; // TUI-only slash actions are not advertised as API commands.
  }
  async read(id: string) { await this.rpc.connect(); return (await this.rpc.request('thread/read', {threadId:id,includeTurns:false})).thread; }
  async turns(id: string) { return (await this.rpc.request('thread/turns/list', { threadId:id, limit:20, sortDirection:'desc', itemsView:'summary' })).data as any[]; }
  async items(id: string, turnId: string) {
    const items: any[] = []; let cursor: string | null = null;
    do { const p = await this.rpc.request('thread/items/list', { threadId:id, turnId, limit:100, ...(cursor ? {cursor} : {}) }); items.push(...p.data.map((x: any) => x.item)); cursor = p.nextCursor; } while(cursor);
    return items;
  }
  async history(id: string) {
    const turns = await this.turns(id); const entries = [];
    for (const turn of turns.slice(0,8).reverse()) {
      const items = await this.items(id,turn.id);
      for (const item of items) if (item.type === 'userMessage') entries.push({ text: item.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n'), time:(turn.startedAt || 0)*1000 });
    }
    return entries;
  }
  private async attach(id: string) {
    await this.rpc.connect();
    if(this.attached.has(id)) return this.read(id);
    const r = await this.rpc.request('thread/resume', {threadId:id,excludeTurns:true});
    if (r.thread.id !== id) throw new Error('恢复返回了不同会话，已停止');
    this.attached.add(id); this.threadSettings.set(id,r.thread);return r.thread;
  }
  private async wait(id: string, turnId: string, update: (a: Activity) => void): Promise<NativeResult> {
    update({ state:'running', text:'等待 Codex 原生轮次完成', nativeId:turnId });
    while (true) {
      const approval = [...this.approvals.values()].find(m => m.params.threadId === id && (!m.params.turnId || m.params.turnId === turnId));
      if (approval) update({ state:'approval',text:`等待原生审批：${approval.method}`,nativeId:turnId });
      const event = this.notifications.get(`${id}:${turnId}`);
      let turn=event;
      if(!turn)try{turn=(await this.turns(id)).find(t=>t.id===turnId);}catch(error){
        if(!/rollout.*empty|missing source rollout/.test(String(error)))throw error;
        // A newly admitted turn can precede the first durable rollout flush.
        // Keep observing that exact accepted turn; never resend the prompt.
      }
      if (!turn) { await sleep(800);continue; }
      if (!event && turn.status === 'interrupted') {
        // Paginated history temporarily projects a live, unfinished turn as
        // interrupted before its terminal record is flushed. A native terminal
        // event or a settled live state must corroborate that historical status.
        const thread=await this.read(id).catch(()=>null);
        if(!thread || thread.status?.type==='active' || turn.completedAt==null){await sleep(800);continue;}
      }
      if (turn.status !== 'inProgress') {
        if (turn.status !== 'completed') throw new Error(turn.error?.message || `Codex 轮次 ${turn.status}`);
        let items:any[];
        try{items=await this.items(id,turnId);}catch(error){
          if(!event)throw error;
          items=[...(this.completedItems.get(`${id}:${turnId}`)?.values()||[]),...(event.items||[])];
        }
        const text = codexFinalText([...new Map(items.map(i=>[i.id,i])).values()]);
        if (!text.trim()) throw new Error('Codex 已完成但没有最终助手文本');
        const thread = await this.read(id).catch(()=>this.threadSettings.get(id));
        return {id:turnId,text,model:thread?.model,effort:thread?.reasoningEffort};
      }
      await sleep(800);
    }
  }
  async listen(id: string, update: (a: Activity) => void) {
    const thread = await this.attach(id); const turns = await this.turns(id);
    // The newest historical row can still be projected as interrupted while
    // the native shared server is actively executing that exact turn.
    const latest = turns[0];
    const active = latest && (latest.status === 'inProgress' || (latest.status === 'interrupted' && latest.completedAt == null)) ? latest : undefined;
    if (!active || thread.status.type !== 'active') throw new Error('该会话当前没有可监听的在途轮次；请选择启动模式');
    update({state:'listening',text:'已附着原 CLI 会话，监听当前轮次',nativeId:active.id});
    return this.wait(id,active.id, a => update({...a,state:a.state === 'running' ? 'listening' : a.state}));
  }
  async send(id: string,text: string,skills: string[],files: string[],update: (a: Activity) => void,beforeSend?:()=>Promise<void>) {
    await this.attach(id);
    while ((await this.read(id)).status.type === 'active') { update({state:'queued',text:'原 CLI 正在工作，完成后发送'}); await sleep(1000); }
    await beforeSend?.();
    const available = await this.resources(id);
    const inputs: any[] = [{ type:'text',text,text_elements:[] }];
    for (const path of skills) { const skill = available.skills.find((s: any) => s.id === path); if (!skill) throw new Error(`Skill 不存在：${path}`); inputs.push({type:'skill',name:skill.name,path}); }
    for (const path of files) inputs.push({type:'mention',name:path.split('/').pop(),path});
    const clientUserMessageId = randomUUID();
    const { turn } = await this.rpc.request('turn/start',{threadId:id,input:inputs,clientUserMessageId});
    update({state:'running',text:'Codex 已接受任务',nativeId:turn.id});
    return this.wait(id,turn.id,update);
  }
}
