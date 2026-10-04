import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import type { Activity, Conversation, Harness, HarnessAdapter, NodeRun, Workflow, WorkflowRun } from '../shared/types';
import { orderedSteps, renderPrompt, validateWorkflow } from '../shared/workflow';
const sleep = (ms: number) => new Promise(r=>setTimeout(r,ms));
export class Engine extends EventEmitter {
  readonly runs = new Map<string, WorkflowRun>();
  readonly locks = new Map<string, Promise<void>>();
  private writes: Promise<void> = Promise.resolve();
  constructor(readonly adapters: Record<Harness,HarnessAdapter>, readonly dataDir = path.join(process.cwd(),'.sessionweave')) { super(); }
  async initialize() {
    await mkdir(path.join(this.dataDir,'runs'),{recursive:true});
    for (const file of await readdir(path.join(this.dataDir,'runs'))) if (file.endsWith('.json')) {
      const r: WorkflowRun = JSON.parse(await readFile(path.join(this.dataDir,'runs',file),'utf8'));
      // A restart must not resend uncertain inputs. Preserve snapshots and show an explicit stop.
      if (r.state === 'running' || r.state === 'paused') { r.state = 'failed'; for(const n of r.nodes) if(n.state !== 'succeeded') {n.state='failed';n.error='后端重启；请核对原生会话，未自动重发';} }
      this.runs.set(r.id,r);
    }
  }
  private persist(run: WorkflowRun) {
    const content = JSON.stringify(run,null,2); const target = path.join(this.dataDir,'runs',`${run.id}.json`);
    this.writes = this.writes.then(async()=> {const temp=target+'.tmp'; await writeFile(temp,content); await rename(temp,target);});
    this.writes.catch(e=>this.emit('storageError',e));
    this.emit('run',structuredClone(run));
    return this.writes;
  }
  private async lock(key: string) {
    const previous = this.locks.get(key) || Promise.resolve();
    let release!: ()=>void; const current = new Promise<void>(r=>{release=r;});
    const tail = previous.then(()=>current); this.locks.set(key,tail);
    await previous;
    return ()=> {release(); if(this.locks.get(key)===tail)this.locks.delete(key);};
  }
  private async gate(run: WorkflowRun) { while(run.state==='paused')await sleep(150); if(run.state==='failed')throw new Error('流程已停止'); }
  async start(workflow: Workflow, conversations: Conversation[]) {
    const w = validateWorkflow(workflow,conversations);
    const run: WorkflowRun = {id:randomUUID(),workflow:structuredClone(w),state:'running',createdAt:Date.now(),testing:w.nodes.every(n=>conversations.find(c=>c.id===n.conversationRef.id&&c.harness===n.conversationRef.harness)?.testing),nodes:w.nodes.map(n=>({id:randomUUID(),nodeId:n.id,state:'queued',inputTemplate:n.promptTemplate,activity:'等待上游完成'}))};
    this.runs.set(run.id,run); await this.persist(run);
    void this.execute(run).catch(e=>this.emit('diagnostic',String(e)));
    return run;
  }
  async pause(id: string,paused: boolean) {
    const run=this.runs.get(id); if(!run)throw new Error('流程不存在'); if(!['running','paused'].includes(run.state))throw new Error('流程已结束');
    run.state=paused?'paused':'running'; await this.persist(run); return run;
  }
  private async execute(run: WorkflowRun) {
    const outputs=new Map<string,string>(); let active: NodeRun | undefined;
    try {
      for(const step of orderedSteps(run.workflow)) {
        await this.gate(run); active=run.nodes.find(n=>n.nodeId===step.id)!;
        const node=active; node.activity='等待会话调度锁'; await this.persist(run);
        const release=await this.lock(`${step.conversationRef.harness}:${step.conversationRef.id}`);
        try {
          await this.gate(run); node.startedAt=Date.now();
          const update=(a: Activity)=> { if(a.state)node.state=a.state;node.activity=a.text;if(a.nativeId)node.nativeTurnOrMessageId=a.nativeId;void this.persist(run); };
          const adapter=this.adapters[step.conversationRef.harness];
          let result;
          if(step.mode==='listen') result=await adapter.listen(step.conversationRef.id,update);
          else {
            let prompt=renderPrompt(step.promptTemplate,step.upstreamOutputRefs,outputs);
            if(step.polishBeforeSend && step.upstreamOutputRefs.length) {
              update({state:'polishing',text:`Space Bunny ${run.testing?'Low 测试':'Default'} 正在润色接力指令`});
              const polished=await this.auxiliary(`只润色下面任务指令，使结构清晰、要求明确。不要执行业务任务、调用工具、添加事实或删除约束。不要改写输出引用占位符。只输出润色后的指令，不要解释。\n\n任务指令：\n${step.promptTemplate}\n\n下游用途：${step.purpose}`,'Prompt polish',run.testing);
              const instruction=polished.replace(/\{\{[^{}]+\.output\}\}/g,'');
              // Original instruction and output are retained verbatim after the polished instruction.
              prompt=`${instruction}\n\n<original_requirements>\n${step.promptTemplate.replace(/\{\{[^{}]+\.output\}\}/g,'[原始上游输出见下方]')}\n</original_requirements>`;
              prompt=renderPrompt(prompt,step.upstreamOutputRefs,outputs);
            }
            node.actualSentPrompt=prompt; await this.persist(run);
            result=await adapter.send(step.conversationRef.id,prompt,step.selectedSkills,step.selectedFiles,update,()=>this.gate(run));
          }
          Object.assign(node,{state:'succeeded',completedAt:Date.now(),outputSnapshot:result.text,nativeTurnOrMessageId:result.id,model:result.model,effort:result.effort,activity:'已保存本轮最终回答'});
          outputs.set(step.id,result.text); await this.persist(run);
        } finally {release();}
      }
      run.state='succeeded';run.completedAt=Date.now();await this.persist(run);
    } catch(error) {
      if(active){active.state='failed';active.error=error instanceof Error?error.message:String(error);active.completedAt=Date.now();}
      for(const node of run.nodes)if(node!==active&&node.state==='queued'){node.state='failed';node.error='上游步骤失败，未派发';node.activity='流程已停止';node.completedAt=Date.now();}
      run.state='failed';run.completedAt=Date.now();await this.persist(run);
    }
  }
  async auxiliary(text: string,title: string,testing=false) {
    const adapter=this.adapters.opencode;
    const session=await adapter.create(`SessionWeave auxiliary ${testing?'test ':''}· ${title}`,testing,{id:'space-bunny-free',providerID:'opencode',effort:testing?'low':'default'});
    const result=await adapter.send(session.id,text,[],[],()=>{});
    return result.text;
  }
  async plan(description: string,conversations: Conversation[], selectedSkills: Record<string,string[]>, previous?: Workflow) {
    if(!description.trim())throw new Error('请输入自然语言需求');
    if(!conversations.length)throw new Error('请先选择至少一个真实会话');
    const resources=await Promise.all(conversations.map(async c=>({harness:c.harness,id:c.id,title:c.title,skills:(await this.adapters[c.harness].resources(c.id)).skills.filter(s=>(selectedSkills[`${c.harness}:${c.id}`]||[]).includes(s.id))})));
    const instructions=`你是 SessionWeave 的工作流规划器，只生成计划，不执行业务任务、不调用工具、不发送其他会话消息。只输出一个 JSON 对象，不能使用 Markdown。模型为 Space Bunny Default。\nJSON 必须符合：{"id":"draft","name":"流程名称","nodes":[{"id":"A1","conversationRef":{"harness":"opencode或codex","id":"真实会话ID"},"purpose":"任务意图","mode":"kickoff或listen","promptTemplate":"完整任务指令，可含 {{A1.output}}","selectedSkills":["真实SkillID"],"selectedFiles":[],"upstreamOutputRefs":[],"polishBeforeSend":false}],"edges":[{"id":"A1-B","source":"A1","target":"B"}]}。\n只能使用所给真实会话和勾选的Skill；不得虚构文件路径。每个执行步骤一个唯一ID，重复用同一会话须创建新步骤。图无环。接力节点引用上游输出并 polishBeforeSend:true。用户描述 A→B→A 时生成 A1、B、A3 三步后结束。监听步骤不发送新输入，只有用户明确要求监听在途任务时使用 listen。若有已有计划，根据修改要求生成完整新草稿。\n真实资源：${JSON.stringify(resources)}\n已有计划：${JSON.stringify(previous||null)}\n用户需求：${description}`;
    const text=await this.auxiliary(instructions+'\nupstreamOutputRefs 只写步骤 ID，例如 ["A1"]，不要写 "A1.output"。提示词中的引用才写 {{A1.output}}。保持用户请求的输出规模，不能擅自扩展候选数或额外报告。','Plan',conversations.every(c=>c.testing));
    const clean=text.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,'');
    let parsed;try{parsed=JSON.parse(clean);}catch{throw new Error('模型未返回有效 JSON；没有修改画布或执行任务，请调整描述后重试');}
    parsed.id=randomUUID();
    if(!Array.isArray(parsed.nodes))throw new Error('模型计划没有步骤数组');
    const ids=new Set(parsed.nodes.map((n:any)=>n.id));
    parsed.nodes=parsed.nodes.map((n:any,i:number)=>({...n,upstreamOutputRefs:Array.isArray(n.upstreamOutputRefs)?n.upstreamOutputRefs.map((ref:unknown)=>typeof ref==='string'&&!ids.has(ref)&&ref.endsWith('.output')&&ids.has(ref.slice(0,-7))?ref.slice(0,-7):ref):n.upstreamOutputRefs,position:{x:80+i*360,y:150}}));
    const workflow=validateWorkflow(parsed,conversations);
    for(const n of workflow.nodes) {
      const allowed=selectedSkills[`${n.conversationRef.harness}:${n.conversationRef.id}`]||[];
      if(n.selectedSkills.some(s=>!allowed.includes(s)))throw new Error('模型选择了未勾选的 Skill，草稿未确认');
    }
    return workflow;
  }
}
