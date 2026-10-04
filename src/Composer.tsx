import { useEffect, useRef, useMemo } from 'react';
import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, keymap, placeholder } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { autocompletion, startCompletion, completionStatus, type Completion, type CompletionContext } from '@codemirror/autocomplete';
import { useMessageHistory } from './vendor/openchamber/state/useMessageHistory';
import { scanMentions } from './vendor/openchamber/language/mentions';
import type { Harness, Resource } from '../shared/types';
export default function Composer({value,onChange,identity,harness,historyTexts=[],skills=[],upstream=[],onSkill,onModel,disabled=false}: {
  value:string;onChange:(s:string)=>void;identity:string;harness:Harness;historyTexts?:string[];skills?:Resource[];upstream?:string[];onSkill?:(id:string)=>void;onModel?:()=>void;disabled?:boolean;
}) {
  const host=useRef<HTMLDivElement>(null),view=useRef<EditorView|null>(null),latest=useRef({value,onChange,onSkill,onModel,disabled,harness});latest.current={value,onChange,onSkill,onModel,disabled,harness};
  const historyValues=useMemo(()=>historyTexts.map(text=>({text,attachments:[]})),[historyTexts]);
  const navigation=useMessageHistory(historyValues,identity);const nav=useRef(navigation);nav.current=navigation;
  const resources=useRef({skills,upstream});resources.current={skills,upstream};
  const editable=useRef(new Compartment());
  useEffect(()=>{
    if(!host.current)return;
    const complete=(context:CompletionContext)=>{
      const word=context.matchBefore(/[@$/][^\s{}]*|\{\{[^\s{}]*/);if(!word||(!context.explicit&&word.from===word.to))return null;
      if(word.from>0&&!/\s/.test(context.state.doc.sliceString(word.from-1,word.from)))return null;
      // OpenChamber scanner supplies the same mention boundaries used by highlighting.
      scanMentions(context.state.doc.toString());
      const prefix=word.text[0];
      const options:Completion[]=word.text.startsWith('{{')?resources.current.upstream.map(id=>({label:`{{${id}.output}}`,type:'variable',detail:'本次运行输出快照'})):
        prefix==='/'&&latest.current.harness==='codex'?[]:resources.current.skills.map(skill=>({label:`${prefix}${skill.name}`,detail:'Skill · 原生附件',type:'keyword',apply:(editor:EditorView,_completion:unknown,from:number,to:number)=>{editor.dispatch({changes:{from,to,insert:`${prefix}${skill.name} `}});latest.current.onSkill?.(skill.id);}}));
      if(prefix==='/'&&word.from===0)options.unshift({label:'/model',detail:'打开会话模型选择器',type:'keyword',apply:(editor:EditorView,_completion:unknown,from:number,to:number)=>{editor.dispatch({changes:{from,to,insert:''}});latest.current.onModel?.();}});
      return {from:word.from,options};
    };
    const editor=new EditorView({parent:host.current,state:EditorState.create({doc:latest.current.value,extensions:[
      history(),keymap.of([
        {key:'ArrowUp',run:v=>{if(v.composing||completionStatus(v.state)||v.state.selection.main.head!==0)return false;const old=nav.current.older({text:v.state.doc.toString(),attachments:[]});if(!old)return false;v.dispatch({changes:{from:0,to:v.state.doc.length,insert:old.text},selection:{anchor:0}});return true;}},
        {key:'ArrowDown',run:v=>{if(v.composing||completionStatus(v.state)||v.state.selection.main.head!==v.state.doc.length)return false;const next=nav.current.newer({text:v.state.doc.toString(),attachments:[]});if(!next)return false;v.dispatch({changes:{from:0,to:v.state.doc.length,insert:next.text},selection:{anchor:next.text.length}});return true;}},
        ...defaultKeymap,...historyKeymap]),
      autocompletion({override:[complete],activateOnTypingDelay:80}),placeholder('写下这一步要完成的任务…\n输入 $ 选择 Skill，/model 切换模型，{{ 引用上游输出'),EditorView.lineWrapping,
      editable.current.of(EditorView.editable.of(!latest.current.disabled)),
      EditorView.updateListener.of(update=>{if(update.docChanged){latest.current.onChange(update.state.doc.toString());if(update.transactions.some(t=>t.isUserEvent('input.type'))&&/[@$/]$|\{\{$/.test(update.state.doc.sliceString(0,update.state.selection.main.head)))queueMicrotask(()=>{if(view.current===update.view)startCompletion(update.view);});}}),
      EditorView.theme({'&':{fontSize:'13px',background:'transparent',color:'var(--fg)'},'.cm-content':{minHeight:'100px',fontFamily:'var(--font-mono)',padding:'12px',caretColor:'var(--accent)'},'.cm-scroller':{overflow:'auto'},'&.cm-focused':{outline:'none'},'.cm-cursor':{borderLeftColor:'var(--accent)'},'.cm-selectionBackground':{background:'var(--selection)!important'},'.cm-tooltip':{background:'var(--cream)',color:'var(--fg)',border:'1px solid var(--line-strong)'},'.cm-tooltip-autocomplete ul li[aria-selected]':{background:'var(--selection)',color:'var(--selection-fg)'},'.cm-activeLine':{background:'transparent'},'.cm-placeholder':{color:'var(--muted)'}})
    ]})});view.current=editor;
    return()=>{editor.destroy();view.current=null;};
  },[identity]);
  useEffect(()=>{const v=view.current;if(v&&v.state.doc.toString()!==value)v.dispatch({changes:{from:0,to:v.state.doc.length,insert:value}});},[value]);
  useEffect(()=>{const v=view.current;if(v?.hasFocus&&!disabled&&/[@$/][^\s{}]*$|\{\{[^\s{}]*$/.test(v.state.doc.sliceString(0,v.state.selection.main.head)))startCompletion(v);},[skills,upstream,disabled]);
  useEffect(()=>{view.current?.dispatch({effects:editable.current.reconfigure(EditorView.editable.of(!disabled))});},[disabled]);
  return <div className="composer" ref={host}/>;
}
