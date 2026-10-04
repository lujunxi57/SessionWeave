import { z } from 'zod';
import type { Conversation, Workflow } from './types';
const step = z.object({
  id: z.string().min(1).max(100), conversationRef: z.object({ harness: z.enum(['codex', 'opencode']), id: z.string().min(1) }),
  purpose: z.string().min(1).max(1000), mode: z.enum(['kickoff','listen']).default('kickoff'),
  promptTemplate: z.string().max(100000), selectedSkills: z.array(z.string()).default([]),
  selectedFiles: z.array(z.string()).default([]), upstreamOutputRefs: z.array(z.string()).default([]),
  polishBeforeSend: z.boolean().default(false), position: z.object({ x: z.number(), y: z.number() }).default({ x: 0, y: 0 }),
}).strict();
export const workflowSchema = z.object({ id: z.string().min(1), name: z.string().min(1).max(200), nodes: z.array(step).min(1).max(12),
  edges: z.array(z.object({ id: z.string(), source: z.string(), target: z.string() }).strict()).max(30) }).strict();
export function validateWorkflow(value: unknown, resources?: Conversation[]): Workflow {
  const w = workflowSchema.parse(value); const ids = new Set(w.nodes.map(n => n.id));
  if (ids.size !== w.nodes.length) throw new Error('步骤 ID 重复');
  const edgeIds = new Set(w.edges.map(e => e.id));
  if (edgeIds.size !== w.edges.length) throw new Error('连线 ID 重复');
  for (const e of w.edges) if (!ids.has(e.source) || !ids.has(e.target) || e.source === e.target) throw new Error('连线引用不存在的步骤或自身');
  orderedSteps(w);
  for (const n of w.nodes) {
    if (resources && !resources.some(c => c.id === n.conversationRef.id && c.harness === n.conversationRef.harness)) throw new Error(`步骤 ${n.id} 的会话不存在`);
    if (n.mode === 'kickoff' && !n.promptTemplate.trim()) throw new Error(`步骤 ${n.id} 需要提示词`);
    const ancestors = new Set<string>();
    function visit(id: string) { for (const e of w.edges.filter(e => e.target === id)) if (!ancestors.has(e.source)) { ancestors.add(e.source); visit(e.source); } }
    visit(n.id);
    for (const ref of n.upstreamOutputRefs) if (!ancestors.has(ref)) throw new Error(`步骤 ${n.id} 只能引用上游输出`);
    for (const match of n.promptTemplate.matchAll(/\{\{([^{}]+)\.output\}\}/g)) if (!n.upstreamOutputRefs.includes(match[1])) throw new Error(`输出引用 ${match[1]} 未绑定`);
    if (n.mode === 'listen' && (n.upstreamOutputRefs.length || n.selectedSkills.length || n.selectedFiles.length)) throw new Error('监听步骤不能添加新输入或资源');
  }
  return w;
}
export function orderedSteps(w: Workflow) {
  const done = new Set<string>(); const result = [];
  while (done.size < w.nodes.length) {
    const next = w.nodes.find(n => !done.has(n.id) && w.edges.filter(e => e.target === n.id).every(e => done.has(e.source)));
    if (!next) throw new Error('流程包含环，请用不同步骤引用同一会话');
    result.push(next); done.add(next.id);
  }
  return result;
}
export function renderPrompt(template: string, refs: string[], outputs: Map<string,string>) {
  const selected=new Set(refs);
  let text = template.replace(/\{\{([^{}]+)\.output\}\}/g,(token,id)=>{
    if(!selected.has(id))throw new Error(`输出引用 ${id} 未绑定`);
    const output=outputs.get(id);if(output===undefined)throw new Error(`上游 ${id} 没有完成快照`);
    return output;
  });
  for (const id of refs) {
    const output = outputs.get(id); if (output === undefined) throw new Error(`上游 ${id} 没有完成快照`);
    const token = `{{${id}.output}}`;
    if (!template.includes(token)) text += `\n\n<upstream_output step="${id}">\n${output}\n</upstream_output>`;
  }
  return text;
}
