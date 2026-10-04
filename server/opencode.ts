import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { OpenCode } from '@opencode/client';
import type { OpenCodeClient } from '@opencode/client';
import type { Activity, Conversation, HarnessAdapter, ModelCatalog, ModelSelection, NativeResult } from '../shared/types';
const sleep = (ms: number) => new Promise(r => setTimeout(r,ms));
const model = { providerID:'opencode', id:'space-bunny-free' };
export function openCodeSnapshot(messages: any[], messageId: string) {
  const start = messages.findIndex(m => m.id === messageId);
  if (start < 0) return null;
  const end = messages.findIndex((m,i) => i > start && m.type === 'idle');
  if (end < 0) return null;
  const range = messages.slice(start+1,end);
  if (range.some(m => m.type === 'user')) throw new Error('检测到另一客户端追加输入；输出归属需要核对，已停止接力');
  const idle = messages[end];
  if (idle.outcome !== 'succeeded') throw new Error(`OpenCode 执行 ${idle.outcome || '未知状态'}`);
  const assistant = range.filter(m => m.type === 'assistant' && m.finish !== 'tool-calls').at(-1);
  if (assistant?.error) throw new Error(assistant.error.message || 'OpenCode 模型错误');
  const text = assistant?.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n') || '';
  if (!text.trim()) throw new Error('OpenCode 已完成但没有最终助手文本');
  return { id:messageId, text, model:`${assistant.model.providerID}/${assistant.model.id}`, effort:assistant.model.variant || 'default' };
}
export class OpenCodeAdapter implements HarnessAdapter {
  private client?: OpenCodeClient;
  private eventStarted = false;
  private activity = new Map<string, any>();
  async api() {
    if (!this.client) {
      const config = JSON.parse(await readFile(process.env.OPENCODE_SERVICE_FILE || `${homedir()}/.config/opencode/service.json`,'utf8'));
      const password = process.env.OPENCODE_SERVER_PASSWORD || config.password;
      this.client = OpenCode.make({ baseUrl:process.env.OPENCODE_URL || 'http://127.0.0.1:49374', headers:{ Authorization:`Basic ${Buffer.from(`opencode:${password}`).toString('base64')}` },
        fetch: (input,init) => fetch(input,{...init,signal:init?.signal || AbortSignal.timeout(30000)}) });
    }
    return this.client;
  }
  async events() {
    if (this.eventStarted) return;
    this.eventStarted = true;
    const api = await this.api();
    void (async () => {
      while (true) {
        try { for await (const event of api.event.subscribe()) { const e = event as any; if (e.data?.sessionID) this.activity.set(e.data.sessionID,e); } }
        catch { await sleep(1000); } // History reconciliation below is authoritative after SSE gaps.
      }
    })();
  }
  private normalize(s: any, active: Record<string,any>, preview=''): Conversation {
    return {id:s.id,harness:'opencode',title:s.title || `OpenCode ${s.id.slice(0,10)}`,preview,cwd:s.location.directory,updatedAt:s.time.updated,
      state:active[s.id] ? 'running' : 'idle',loaded:true,canSend:true,model:s.model ? `${s.model.providerID}/${s.model.id}` : undefined,effort:s.model?.variant || 'default',testing:s.metadata?.sessionweaveTest===true};
  }
  async list() {
    const api = await this.api(); const active = await api.session.active(); const sessions: any[] = []; let cursor: string | undefined;
    do { const page = await api.session.list({limit:100,...(cursor ? {cursor} : {order:'desc'})}); sessions.push(...page.data); cursor = page.cursor.next || undefined; } while(cursor);
    const result: Conversation[] = [];
    for (let i=0;i<sessions.length;i+=6) result.push(...await Promise.all(sessions.slice(i,i+6).map(async s => {
      const page = await api.message.list({sessionID:s.id,limit:1,order:'desc',type:'user'});
      return this.normalize(s,active,(page.data[0] as any)?.text?.slice(0,350) || '');
    })));
    return result;
  }
  async create(title: string,testing=false,preset?:ModelSelection) {
    const selected=preset?{id:preset.id,providerID:preset.providerID!,...(preset.effort&&preset.effort!=='default'?{variant:preset.effort}:{})}:testing?{...model,variant:'low'}:undefined;
    const api = await this.api(); const s = await api.session.create({title,...(selected?{model:selected}:{}),location:{directory:process.cwd()},metadata:testing?{sessionweaveTest:true}:undefined});
    return this.normalize(s,{});
  }
  async models(id:string):Promise<ModelCatalog> {
    const api=await this.api(),session=await api.session.get({sessionID:id});
    const [catalog,providers,active]=await Promise.all([api.model.list({location:session.location}),api.provider.list({location:session.location}),api.session.active()]);
    // Only public picker fields leave the server; native model settings can contain credentials.
    const models=catalog.data.filter(m=>m.enabled&&m.status==='active').map(m=>({id:m.id,name:m.name,providerID:m.providerID,providerName:providers.data.find(p=>p.id===m.providerID)?.name||m.providerID,efforts:['default',...m.variants.map(v=>v.id).filter(v=>v!=='default')],defaultEffort:'default'}));
    const fallback=!session.model?(await api.model.default({location:session.location})).data:null;
    const current={id:session.model?.id||fallback?.id||'',providerID:session.model?.providerID||fallback?.providerID,effort:session.model?.variant||'default'};
    return {models,current,conversation:{...this.normalize(session,active),model:current.id?`${current.providerID}/${current.id}`:undefined,effort:current.effort},source:session.model?'session':'preset'};
  }
  async setModel(id:string,selection:ModelSelection) {
    const catalog=await this.models(id),chosen=catalog.models.find(m=>m.id===selection.id&&m.providerID===selection.providerID);
    if(!chosen)throw new Error('模型不在当前 OpenCode 可用目录中');
    const effort=selection.effort||chosen.defaultEffort;
    if(!chosen.efforts.includes(effort))throw new Error('该模型不支持此思考档位');
    const api=await this.api();if((await api.session.active())[id])throw new Error('会话正在运行，结束后再切换模型');
    await api.session.switchModel({sessionID:id,model:{id:chosen.id,providerID:chosen.providerID!,...(effort==='default'?{}:{variant:effort})}});
    const result=await this.models(id);
    if(result.current.id!==chosen.id||result.current.providerID!==chosen.providerID||result.current.effort!==effort)throw new Error('模型切换回读不一致，请刷新会话配置');
    return result;
  }
  async resources(id: string) {
    const api = await this.api(); const session = await api.session.get({sessionID:id});
    const [skills,commands] = await Promise.all([api.skill.list({location:session.location}),api.command.list({location:session.location})]);
    return {skills:skills.data.map((s: any) => ({id:s.id,name:s.name,description:s.description,path:s.path})),commands:commands.data.map((c: any) => ({id:c.name,name:c.name,description:c.description}))};
  }
  async messages(id: string) {
    const api = await this.api(); const all: any[] = []; let cursor: string | undefined;
    do { const page = await api.message.list({sessionID:id,limit:100,...(cursor ? {cursor} : {order:'desc'})}); all.push(...page.data); cursor = page.cursor.next || undefined; } while(cursor);
    return all.reverse();
  }
  async history(id: string) { return (await this.messages(id)).filter(m=>m.type==='user').map(m=>({text:m.text,time:m.time.created})); }
  private async wait(id: string,messageId: string,update: (a: Activity) => void): Promise<NativeResult> {
    const api = await this.api();
    while (true) {
      const snapshot = openCodeSnapshot(await this.messages(id),messageId);
      if (snapshot) return snapshot;
      const e = this.activity.get(id);
      const permissions = await api.permission.list({sessionID:id});
      if (permissions.length) update({state:'approval',text:'等待原生权限审批，请在原客户端处理',nativeId:messageId});
      else if (e) update({state:'running',text:e.type === 'session.text.delta' ? '正在生成回答…' : e.type,nativeId:messageId});
      await sleep(750);
    }
  }
  async listen(id: string,update: (a: Activity) => void) {
    await this.events(); const api = await this.api(); const active = await api.session.active();
    if (!active[id]) throw new Error('该 OpenCode 会话没有在途执行，请选择启动模式');
    const messages = await this.messages(id); const lastIdle = messages.findLastIndex(m=>m.type==='idle');
    const anchor = messages.slice(lastIdle+1).find(m=>m.type==='user');
    if (!anchor) throw new Error('无法识别当前执行的用户消息，未监听旧回答');
    update({state:'listening',text:'已绑定原 TUI 当前执行',nativeId:anchor.id});
    return this.wait(id,anchor.id,a=>update({...a,state:a.state==='running' ? 'listening' : a.state}));
  }
  async send(id: string,text: string,skills: string[],files: string[],update: (a: Activity) => void,beforeSend?:()=>Promise<void>) {
    await this.events(); const api = await this.api();
    while ((await api.session.active())[id]) { update({state:'queued',text:'原 TUI 正在工作，完成后发送'}); await sleep(1000); }
    await beforeSend?.();
    const available = await this.resources(id);
    for (const skill of skills) if (!available.skills.some(s=>s.id===skill)) throw new Error(`Skill 不存在：${skill}`);
    const session=await api.session.get({sessionID:id});
    const admitted = await api.session.prompt({sessionID:id,text,skills:skills.map(id=>({id})),files:files.map(path=>({uri:pathToFileURL(path).href,name:path.split('/').pop()})),delivery:'queue'});
    update({state:'running',text:`OpenCode 已持久接收输入 · ${session.model?`${session.model.providerID}/${session.model.id} · ${session.model.variant||'Default'}`:'沿用原生预设'}`,nativeId:admitted.id});
    return this.wait(id,admitted.id,update);
  }
}
