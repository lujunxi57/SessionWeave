import Fastify from 'fastify';
import { createServer as createVite } from 'vite';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { homedir } from 'node:os';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import { CodexAdapter } from './codex';
import { OpenCodeAdapter } from './opencode';
import { Engine } from './engine';
import { validateWorkflow } from '../shared/workflow';
import type { Conversation, Harness, Workflow } from '../shared/types';
const app=Fastify({logger:false,bodyLimit:2*1024*1024});
const runFile=promisify(execFile);
let socket=process.env.CODEX_SOCKET;
if(!socket)try{socket=JSON.parse(execFileSync('codex',['app-server','daemon','version'],{encoding:'utf8',timeout:10000})).socketPath;}catch{}
const adapters={codex:new CodexAdapter(socket||`${homedir()}/.codex/app-server-control/app-server-control.sock`),opencode:new OpenCodeAdapter()};
const engine=new Engine(adapters);await engine.initialize();
let cached: Conversation[]=[];let connections: Record<string,{ok:boolean;error?:string}>={};let refresh:Promise<void>|undefined;let refreshedAt=0;
async function discover(force=false) {
  if(!force&&Date.now()-refreshedAt<10000)return;
  if(refresh)return refresh;
  refresh=(async()=>{
    const result=await Promise.allSettled([adapters.codex.list(),adapters.opencode.list()]);
    const list:Conversation[]=[];
    for(let i=0;i<result.length;i++){const r=result[i],h=i===0?'codex':'opencode';if(r.status==='fulfilled'){list.push(...r.value);connections[h]={ok:true};}else{connections[h]={ok:false,error:String(r.reason?.message||r.reason)};list.push(...cached.filter(c=>c.harness===h).map(c=>({...c,state:'unavailable' as const})));}}
    cached=list.sort((a,b)=>b.updatedAt-a.updatedAt);refreshedAt=Date.now();
  })().finally(()=>{refresh=undefined;});return refresh;
}
const refSchema=z.object({harness:z.enum(['codex','opencode']),id:z.string().min(1)});
app.addHook('onRequest',async(req,reply)=>{
  if(req.method==='POST' && req.headers.origin){const origin=new URL(req.headers.origin);if(origin.host!==req.headers.host){reply.code(403);throw new Error('请求来源与当前网页不一致');}}
});
app.setErrorHandler((error,req,reply)=>{reply.code(error instanceof z.ZodError?400:500).send({error:error instanceof Error?error.message:String(error)});});
app.get('/api/status',async()=>{await discover();return{connections,sessions:cached.length,model:'OpenCode / Space Bunny · Default',storage:'JSON + event snapshots',cwd:process.cwd()};});
app.get('/api/sessions',async(req)=>{await discover((req.query as any).refresh==='true');return{data:cached,connections};});
app.post('/api/sessions',async(req)=>{const {harness,title,testing}=z.object({harness:z.enum(['codex','opencode']),title:z.string().min(1).max(200),testing:z.boolean().default(false)}).parse(req.body);const c=await adapters[harness].create(testing?`SessionWeave test · ${title}`:title,testing);refreshedAt=0;return c;});
app.post('/api/resources',async(req)=>{const ref=refSchema.parse(req.body);return adapters[ref.harness].resources(ref.id);});
app.post('/api/history',async(req)=>{const ref=refSchema.parse(req.body);return adapters[ref.harness].history(ref.id);});
app.post('/api/models',async(req)=>{const ref=refSchema.parse(req.body);return adapters[ref.harness].models(ref.id);});
app.post('/api/model',async(req)=>{
  const ref=refSchema.parse(req.body),selection=z.object({id:z.string().min(1),providerID:z.string().optional(),effort:z.string().optional()}).parse((req.body as any).selection);
  if([...engine.runs.values()].some(r=>(r.state==='running'||r.state==='paused')&&r.workflow.nodes.some(n=>n.conversationRef.harness===ref.harness&&n.conversationRef.id===ref.id)))throw new Error('该会话已参与在途流程，结束后再切换模型');
  const result=await adapters[ref.harness].setModel(ref.id,selection);cached=cached.map(c=>c.harness===ref.harness&&c.id===ref.id?{...c,...result.conversation,preview:c.preview}:c);refreshedAt=0;return result;
});
app.post('/api/files',async(req)=>{
  const ref=refSchema.parse(req.body);await discover();const conversation=cached.find(c=>c.id===ref.id&&c.harness===ref.harness);if(!conversation)throw new Error('会话不存在');
  const query=z.string().max(300).parse((req.body as any).query||'');
  const native=await adapters.opencode.api().then(api=>api.file.find({query,location:{directory:conversation.cwd},limit:30})).catch(()=>null);
  if(native?.data.length)return native;
  // Native indexes can lag behind a worktree migration. Discover current files
  // from the selected conversation's real cwd, without following symlinks.
  const {stdout}=await runFile('rg',['--files','--hidden','-g','!.git','-g','!node_modules','-g','!dist','-g','!.sessionweave','-g','!.env','-g','!.aws','-g','!.codex'],{cwd:conversation.cwd,timeout:5000,maxBuffer:8*1024*1024});
  return {location:{directory:conversation.cwd},data:stdout.split('\n').filter(f=>f&&f.toLowerCase().includes(query.toLowerCase())).slice(0,30)};
});
app.get('/api/workflow',async()=>{try{return JSON.parse(await readFile(path.join(engine.dataDir,'workflow.json'),'utf8'));}catch{return null;}});
app.post('/api/workflow',async(req)=>{const w=validateWorkflow(req.body);await mkdir(engine.dataDir,{recursive:true});await writeFile(path.join(engine.dataDir,'workflow.json'),JSON.stringify(w,null,2));return w;});
app.post('/api/plan',async(req)=>{
  const b=z.object({description:z.string().min(1).max(30000),conversationKeys:z.array(z.string()).min(1).max(10),selectedSkills:z.record(z.array(z.string())).default({}),previous:z.unknown().optional()}).parse(req.body);
  await discover(true);const selected=cached.filter(c=>b.conversationKeys.includes(`${c.harness}:${c.id}`));
  if(selected.length!==b.conversationKeys.length)throw new Error('选择的会话已不可用');
  return engine.plan(b.description,selected,b.selectedSkills,b.previous as Workflow|undefined);
});
app.get('/api/runs',async()=>[...engine.runs.values()].sort((a,b)=>b.createdAt-a.createdAt));
app.post('/api/runs',async(req)=>{await discover(true);return engine.start(req.body as Workflow,cached);});
app.post('/api/runs/:id/pause',async(req)=>engine.pause((req.params as any).id,z.object({paused:z.boolean()}).parse(req.body).paused));
app.get('/api/events',async(req,reply)=>{
  reply.hijack();reply.raw.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive','X-Accel-Buffering':'no'});
  const send=(run:unknown)=>reply.raw.write(`event: run\ndata: ${JSON.stringify(run)}\n\n`);
  const listener=(run:unknown)=>send(run);engine.on('run',listener);
  reply.raw.write(': connected\n\n');const keep=setInterval(()=>reply.raw.write(': heartbeat\n\n'),15000);
  req.raw.on('close',()=>{clearInterval(keep);engine.off('run',listener);});
});
app.get('/api/approvals',async()=>[...adapters.codex.approvals.values()].map(m=>({id:String(m.id),method:m.method,threadId:m.params.threadId,turnId:m.params.turnId,summary:m.params.command||m.params.reason||'请在原 Codex CLI 中处理审批'})));
engine.on('storageError',e=>console.error('Run storage error:',e.message));
engine.on('diagnostic',e=>console.error('Run diagnostic:',e));
const production=process.argv.includes('--production');
if(!production){
  const vite=await createVite({server:{middlewareMode:true,hmr:{server:app.server}},appType:'spa'});
  app.get('/*',async(req,reply)=>{reply.hijack();vite.middlewares(req.raw,reply.raw,()=>{reply.raw.statusCode=404;reply.raw.end('Not found');});});
}else{
  app.get('/*',async(req,reply)=>{
    const dist=path.resolve('dist');let file=path.resolve(dist,'.'+decodeURIComponent(req.url.split('?')[0]));
    if(file!==dist&&!file.startsWith(dist+path.sep)){reply.code(403);return '';}
    if(!path.extname(file))file=path.join(dist,'index.html');
    const mime:Record<string,string>={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'};
    try{return reply.type(mime[path.extname(file)]||'application/octet-stream').send(await readFile(file));}catch{reply.code(404);return 'Not found';}
  });
}
const port=Number(process.env.PORT||8787);await app.listen({port,host:process.env.HOST||'127.0.0.1'});
console.log(`SessionWeave ready: http://127.0.0.1:${port} (${production?'production':'development'})`);
