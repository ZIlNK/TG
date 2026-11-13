const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { deferred } = require('./helpers/npc-vm');

function clone(x) { return JSON.parse(JSON.stringify(x)); }
class Element {
  constructor(tag) { this.tagName=tag; this.children=[]; this.listeners={}; this.isConnected=true; this._text=''; }
  appendChild(child) { this.children.push(child); return child; }
  removeChild(child) { this.children.splice(this.children.indexOf(child),1); }
  get firstChild() { return this.children[0]; }
  set textContent(value) { this._text=String(value); this.children=[]; }
  get textContent() { return this._text+this.children.map(c=>c.textContent).join(''); }
  set innerHTML(_) { throw Error('Unsafe HTML'); }
  setAttribute(k,v) { this[k]=v; }
  addEventListener(k,fn) { this.listeners[k]=fn; }
}
function runtime() {
  const calls=[], responses=[], events=[], handlers=new Map(), macros={};
  const c={console,JSON,AbortController,setTimeout,clearTimeout,Config:{saves:{}},
    State:{variables:{location:'Street',position:{locationId:'Street',areaId:'food_stall'},time:{day:1,hour:8,minute:0},player:{name:'玩家',money:25,inventory:{}},quests:{},npcs:{lin:{id:'lin',name:'林婶',locationId:'Street',areaId:'food_stall',dialogue:[],traits:['热心']}}},passage:'NPCChat',activeIndex:0},
    Macro:{add(name,def){macros[name]=def;}},document:{createElement(tag){return new Element(tag);}},
    whenSugarCubeReady(fn){fn();},ModAPI:{on(name,fn){handlers.set(name,fn);},trigger(name,data){if(handlers.has(name))handlers.get(name)(data);}},
    GameLogger:{debug(name,data){events.push({name,data:clone(data)});}},
    LLMEngine:{isAvailable(){return true;},chatRaw(messages,options){calls.push({messages:clone(messages),options});let next=responses.shift();if(next instanceof Error)return Promise.reject(next);return Promise.resolve(next || {text:'结束。'});}},
    Engine:{play(p){c.LLMOperationScope.invalidate('passage-change');c.State.passage=p;}},NarrativeUI:{showToast(){}},
    NPCDirector:{enqueue(){}}
  };c.window=c;vm.createContext(c);
  for(const f of ['movement','quest-engine','llm-prompts','npc-agency-state','npc-tools','llm-operation-scope','llm-tool-runner','llm-ui','quest-events'])vm.runInContext(fs.readFileSync('src/scripts/'+f+'.js','utf8'),c,{filename:f});
  c.NarrativeUI.showToast=function(){};
  c.RegionSystem.ensure();c.NPCAgency.ensure();
  return {c,calls,responses,events,handlers,macros};
}
function questArgs(areas=['food_stall']) {return {title:'探望街坊',description:'看看街坊今天是否安好，再回来汇报。',rewardMode:'npc_discretionary',rewards:[],objectives:[{id:'visit',text:'探望街坊',type:'visit',actionId:'visit-wang',locations:['Street'],areas,required:1,promptHint:'去探望街坊'}],turnIn:{type:'npc',npcId:'lin',locationId:'Street',areaId:'food_stall'}};}
function setup(h,args=questArgs()) {let p=h.c.TaskEngine.prepareDefinition(args,'lin',{eventDriven:true});assert.equal(p.ok,true,p.error);h.c.State.variables.quests[p.quest.id]=p.quest;let action={questId:p.quest.id,objectiveId:p.quest.objectives[0].id,actionId:p.quest.objectives[0].actionId,amount:1};h.c.QuestEvents.begin(action);return {quest:p.quest,action};}
function tool(name,args) {return {text:'',tool_calls:[{id:'call-1',type:'function',function:{name,arguments:JSON.stringify(args)}}]};}
const opening={description:'门口安静，屋内传来咳嗽声，你还没有敲门。',choices:['敲门问候','先在门外询问']};
const completion={description:'你敲门后见到老人。他只是腿疼，正在家中休息。',choices:[],outcome:'progress',summary:'玩家敲门确认老人平安，因腿疼留在家中休息。'};
async function open(h) {h.responses.push(tool('present_quest_scene',opening),{text:'请选择行动。'});return h.c.QuestEvents.run();}
function stage(h,draft,name,args){return h.c.NPCTools.stage({name,arguments:args},draft);}

test('NPC context exposes the complete current catalog using existing fields and a detached copy',()=>{
  const h=runtime(),ctx=h.c.NPCAgency.buildContext('lin');
  assert.equal(Object.keys(ctx.questLocations).length,4);
  assert.equal(ctx.questLocations.Street.areas.food_stall.description,'街角冒着热气的早餐摊。');
  assert.deepEqual(ctx.questLocations.Shop.connections,['Street']);
  assert.equal(ctx.questLocations.Street.areas.food_stall.activities,undefined);
  ctx.questLocations.Street.areas.food_stall.name='修改';assert.equal(h.c.State.variables.regions.Street.areas.food_stall.name,'早餐摊');
});

test('registration stays in draft, reuses aliases, and produces bindable IDs before atomic NPC commit',()=>{
  const h=runtime(),c=h.c,d=c.NPCAgency.createTurnDraft('lin','decision:test',null),pos=clone(c.State.variables.position);
  const args={locationId:'Street',proposedArea:{name:'老街巷12号',description:'沿街可进入的小院。'}};
  const registered=stage(h,d,'register_quest_area',args);assert.equal(registered.status,'STAGED');
  assert.equal(c.State.variables.regions.Street.areas[registered.areaId],undefined);
  const duplicate=stage(h,d,'register_quest_area',args);assert.equal(duplicate.areaId,registered.areaId);
  const alias=stage(h,d,'register_quest_area',{locationId:'Street',proposedArea:{name:'小吃摊',description:'现有早餐摊。'}});assert.equal(alias.areaId,'food_stall');
  assert.equal(stage(h,d,'issue_quest',questArgs([registered.areaId])).status,'STAGED');
  assert.equal(c.NPCTools.commitTurn(d,'你能去看看他吗？').ok,true);
  assert.ok(c.State.variables.regions.Street.areas[registered.areaId]);assert.deepEqual(c.State.variables.position,pos);
  const offer=Object.values(c.State.variables.npcAgency.offers)[0];
  assert.equal(c.NPCTools.resolveOffer(offer.id,'accepted').ok,true);
  const q=c.State.variables.quests[offer.payload.id];assert.equal(q.eventDriven,true);assert.deepEqual(q.objectives[0].areas,[registered.areaId]);
});

test('invalid areas, missing bindings and cyclic prerequisites are rejected without partial live state',()=>{
  const h=runtime(),c=h.c,d=c.NPCAgency.createTurnDraft('lin','decision:x',null);
  assert.equal(stage(h,d,'register_quest_area',{locationId:'Invented',proposedArea:{name:'家',description:'家'}}).status,'REJECTED');
  assert.equal(stage(h,d,'register_quest_area',{locationId:'Street',proposedArea:{name:'家',description:''}}).status,'REJECTED');
  assert.equal(stage(h,d,'issue_quest',questArgs([])).status,'REJECTED');
  assert.equal(stage(h,d,'issue_quest',questArgs(['park_path'])).status,'REJECTED');
  const args=questArgs();args.objectives.push({...args.objectives[0],id:'report',prerequisites:['visit']});args.objectives[0].prerequisites=['report'];
  assert.equal(stage(h,d,'issue_quest',args).status,'REJECTED');
  assert.equal(Object.keys(c.State.variables.npcAgency.offers).length,0);
});

test('stale world or cancelled NPC draft cannot register a new area',()=>{
  const h=runtime(),c=h.c,d=c.NPCAgency.createTurnDraft('lin','decision:x',null);
  const result=stage(h,d,'register_quest_area',{locationId:'Street',proposedArea:{name:'小院',description:'一个小院。'}});
  c.State.variables.regions.Street.areas.food_stall.description='世界已变化';
  assert.equal(c.NPCTools.commitTurn(d,'去小院看看。').status,'stale');
  assert.equal(c.State.variables.regions.Street.areas[result.areaId],undefined);
});

test('unknown/disconnected regions cannot become task destinations; dynamic registration honors the area cap',()=>{
  const h=runtime(),c=h.c,d=c.NPCAgency.createTurnDraft('lin','decision:x',null);
  d.regions.Island={id:'Island',connections:[],areas:{dock:{id:'dock'}}};
  assert.equal(stage(h,d,'register_quest_area',{locationId:'Island',proposedArea:{name:'码头',description:'码头'}}).status,'REJECTED');
  for(let i=0;i<24;i++)d.regions.Street.areas['extra'+i]={id:'extra'+i,generated:true,name:'地点'+i};
  assert.equal(stage(h,d,'register_quest_area',{locationId:'Street',proposedArea:{name:'再加一个',description:'新地点'}}).status,'REJECTED');
});

test('model cannot inject precompleted progress or evidence in a new task',()=>{
  const h=runtime(),args=questArgs();Object.assign(args.objectives[0],{current:1,completed:true,lastAction:{result:'伪造'}});
  const {quest}=setup(h,args);assert.equal(quest.objectives[0].current,0);assert.equal(quest.objectives[0].completed,false);assert.equal(quest.objectives[0].lastAction,null);
});

test('movement and generic effects cannot skip event-backed objectives',async()=>{
  const h=runtime(),{quest,action}=setup(h);
  assert.equal(h.c.TaskEngine.progress(action).ok,false);
  h.handlers.get('playerMoved')({to:{locationId:'Street',areaId:'food_stall'}});
  assert.equal(quest.objectives[0].current,0);assert.equal(quest.status,'active');
});

test('opening scene -> player action -> evidence -> turn-in -> NPC context is a real tool-loop chain',async()=>{
  const h=runtime(),{quest,action}=setup(h),c=h.c,assets=clone(c.State.variables.player);
  assert.equal((await open(h)).ok,true);assert.equal(quest.objectives[0].current,0);
  assert.equal(quest.eventScenes.visit.description,opening.description);
  h.responses.push(tool('resolve_quest_event',completion),{text:'这次探望结束。'});
  assert.equal((await c.QuestEvents.run('敲门问候')).ok,true);
  assert.equal(quest.status,'ready_to_turn_in');assert.equal(quest.result.events[0].playerAction,'敲门问候');
  assert.equal(quest.objectives[0].lastAction.result.summary,completion.summary);
  assert.deepEqual(c.State.variables.player,assets);
  assert.equal((await c.QuestEvents.run('再来一次')).ok,false);assert.equal(quest.result.events.length,1);
  c.State.variables.activeNPCId='lin';assert.equal(c.TaskEngine.turnIn(quest.id,{npcId:'lin'}).ok,true);
  assert.equal(quest.settlement.result.events[0].summary,completion.summary);
  assert.equal(c.NPCAgency.buildContext('lin').questStates[0].result,undefined);
  assert.equal(JSON.stringify(c.NPCAgency.buildContext('lin')).includes(completion.summary),false);
  assert.ok(h.events.some(e=>e.name==='quest-event-committed'));assert.equal(h.calls.length,4);
  assert.equal(h.calls[0].options.operation,'quest-event');
  assert.equal(h.calls[0].options.promptAssembly.sections.map(s=>s.content).join('\n'),h.calls[0].messages[0].content);
});

test('continue outcome retains choices and history without claiming task completion',async()=>{
  const h=runtime(),{quest}=setup(h);await open(h);
  h.responses.push(tool('resolve_quest_event',{description:'没有回应，尚不能确认。',outcome:'continue',summary:'玩家敲门但无人回应。',choices:['再等一会','向邻居打听']}),{text:'还要继续吗？'});
  assert.equal((await h.c.QuestEvents.run('轻敲一下')).ok,true);
  assert.equal(quest.objectives[0].current,0);assert.equal(quest.result,undefined);assert.equal(quest.eventScenes.visit.history.length,2);
});

for(const mode of ['transport','no-tool','invalid','cancel','load','world-change'])test('failed event '+mode+' cannot commit staged progress',async()=>{
  const h=runtime(),{quest}=setup(h);await open(h);const snapshot=clone(h.c.State.variables);
  if(mode==='transport')h.responses.push(tool('resolve_quest_event',completion),new Error('网络断开'));
  if(mode==='no-tool')h.responses.push({text:'已经完成了。'});
  if(mode==='invalid')h.responses.push(tool('resolve_quest_event',{...completion,money:100}),{text:'已完成。'});
  let pending;
  if(['cancel','load','world-change'].includes(mode)){
    const gate=deferred();h.responses.push(tool('resolve_quest_event',completion),gate.promise);pending=h.c.QuestEvents.run('敲门');
    await new Promise(r=>setImmediate(r));
    if(mode==='cancel')h.c.LLMOperationScope.invalidate('cancel');
    if(mode==='load'){h.c.Config.saves.onLoad();h.c.State.variables=clone(snapshot);}
    if(mode==='world-change')h.c.State.variables.quests[quest.id].description='任务已被修改';
    gate.resolve({text:'已完成。'});
  }else pending=h.c.QuestEvents.run('敲门');
  assert.equal((await pending).ok,false);
  const current=h.c.State.variables.quests[quest.id];assert.equal(current.objectives[0].current,0);assert.equal(current.result,undefined);
});

test('save/reload resumes the same opening and concurrent click shares one request',async()=>{
  const h=runtime(),{quest}=setup(h);await open(h);h.c.Config.saves.onLoad();h.c.State.variables=clone(h.c.State.variables);
  const gate=deferred();h.responses.push(gate.promise,{text:'完成。'});
  const one=h.c.QuestEvents.run('敲门'),two=h.c.QuestEvents.run('另一个操作');assert.equal(one,two);
  gate.resolve(tool('resolve_quest_event',completion));assert.equal((await one).ok,true);
  assert.equal(h.c.State.variables.quests[quest.id].result.events.length,1);
});

test('terminal report routes into NPC dialogue, settles once, and generates only the NPC response',async()=>{
  const h=runtime(),args=questArgs();args.objectives.push({id:'report',text:'告诉林婶探望结果',type:'talk',actionId:'report-wang',locations:['Street'],areas:['food_stall'],required:1,prerequisites:['visit'],promptHint:'汇报'});
  const {quest}=setup(h,args);
  assert.equal((await h.c.QuestEvents.travel(quest.id,'report')).ok,false);
  await open(h);h.responses.push(tool('resolve_quest_event',completion),{text:'完成。'});await h.c.QuestEvents.run('敲门');
  assert.equal(quest.status,'ready_to_turn_in');assert.equal(quest.objectives[1].completed,false);
  vm.runInContext(fs.readFileSync('src/scripts/npc-director.js','utf8'),h.c);
  assert.equal((await h.c.QuestEvents.travel(quest.id,'report')).ok,true);
  assert.equal(h.c.State.passage,'NPCChat');assert.equal(h.calls.length,4);
  const report='他说改天再来，我只想告诉你这些。';
  assert.equal(h.c.TaskEngine.turnIn(quest.id,{npcId:'lin',report}).ok,true);
  assert.equal(quest.objectives[1].completed,true);assert.equal(quest.objectives[1].lastAction.source,'npc-turn-in');
  assert.equal(quest.result.events.length,1);assert.equal(quest.eventScenes.report,undefined);
  assert.equal(h.c.TaskEngine.turnIn(quest.id,{npcId:'lin'}).ok,false);
  const jobs=Object.values(h.c.NPCAgency.ensure().jobs);assert.equal(jobs.length,1);
  h.responses.push({text:'林婶放下手里的勺子。\\n“好，我知道了，谢谢你专门回来。”'});
  assert.equal((await h.c.NPCDirector.runDecision(jobs[0].id)).ok,true);
  assert.equal(h.calls.length,5);assert.equal(h.calls[4].options.operation,'npc-agency');
  const messages=JSON.stringify(h.calls[4].messages);
  assert.equal(messages.includes(completion.summary),false);assert.equal(messages.includes(report),true);
  assert.equal(h.c.State.variables.npcs.lin.dialogue.at(-1).content.includes('\\n'),false);
  assert.equal(Object.values(h.c.NPCAgency.ensure().facts).filter(f=>f.type==='player_statement').length,1);
});

test('repeated objectives require a fresh explicit entry and cannot reuse a committed scene',async()=>{
  const h=runtime(),args=questArgs();args.objectives[0].required=2;const {quest,action}=setup(h,args);
  await open(h);h.responses.push(tool('resolve_quest_event',completion),{text:'完成。'});await h.c.QuestEvents.run('敲门');
  assert.equal(quest.objectives[0].current,1);assert.equal((await h.c.QuestEvents.run('敲门')).ok,false);
  h.c.QuestEvents.begin(action);assert.equal(quest.eventScenes.visit,undefined);
  await open(h);h.responses.push(tool('resolve_quest_event',completion),{text:'完成。'});await h.c.QuestEvents.run('再探望');
  assert.equal(quest.result.events.length,2);assert.notEqual(quest.result.events[0].id,quest.result.events[1].id);
});

test('event UI renders generated text literally and rendering alone never calls the model or advances',async()=>{
  const h=runtime(),{quest}=setup(h);quest.eventScenes={visit:{description:'<img onerror=alert(1)> <<set $money=999>>',choices:['敲门'],history:[],status:'awaiting_action'}};
  const root=new Element('div'),before=JSON.stringify(h.c.State.variables);h.c.QuestEvents.render(root);await new Promise(r=>setTimeout(r,5));
  assert.ok(root.textContent.includes('<img onerror=alert(1)>'));assert.equal(JSON.stringify(h.c.State.variables),before);assert.equal(h.calls.length,0);
});

test('objective travel uses real intermediate regions and registered child areas',async()=>{
  const h=runtime(),c=h.c,args=questArgs(['shop_counter']);args.objectives[0].locations=['Shop'];const {quest}=setup(h,args);
  // setup cannot enter the wrong location; travel still routes there explicitly.
  await c.QuestEvents.travel(quest.id,'visit');assert.equal(c.State.variables.position.locationId,'Shop');
  await c.QuestEvents.travel(quest.id,'visit');assert.equal(c.State.variables.position.areaId,'shop_counter');
  assert.equal(quest.objectives[0].current,0);await c.QuestEvents.travel(quest.id,'visit');assert.equal(c.State.passage,'QuestEvent');
});

test('NPC director runs registration, quest offering and final commit through the real scoped tool runner',async()=>{
  const h=runtime(),c=h.c;
  vm.runInContext(fs.readFileSync('src/scripts/npc-director.js','utf8'),c);
  const args=questArgs(['generated_area_1']);
  h.responses.push(tool('register_quest_area',{locationId:'Street',proposedArea:{name:'街坊小院',description:'街道旁的小院。'}}),tool('issue_quest',args),{text:'可以帮我去小院看看吗？'});
  const job=c.NPCDirector.enqueue('lin',{type:'chat',text:'有什么需要帮忙的？'});
  const result=await c.NPCDirector.runDecision(job.id);assert.equal(result.ok,true,result.error);
  assert.ok(c.State.variables.regions.Street.areas.generated_area_1);
  assert.equal(Object.values(c.State.variables.npcAgency.offers).length,1);
  assert.match(h.calls[0].messages[0].content,/questLocations/);
  assert.match(h.calls[0].messages[0].content,/shop_counter/);
  assert.equal(h.calls[0].options.promptAssembly.sections.map(s=>s.content).join('\n'),h.calls[0].messages[0].content);
});

test('new draft area is discarded when no valid quest references it',()=>{
  const h=runtime(),c=h.c,d=c.NPCAgency.createTurnDraft('lin','decision:orphan',null);
  const result=stage(h,d,'register_quest_area',{locationId:'Street',proposedArea:{name:'无人使用的小院',description:'小院。'}});
  assert.equal(c.NPCTools.commitTurn(d,'再说吧。').ok,false);
  assert.equal(c.State.variables.regions.Street.areas[result.areaId],undefined);
});

test('task result is not committed until the model supplies its final reply after staging',async()=>{
  const h=runtime(),{quest}=setup(h);await open(h);
  const gate=deferred();h.responses.push(tool('resolve_quest_event',completion),gate.promise);
  const promise=h.c.QuestEvents.run('敲门');await new Promise(r=>setImmediate(r));
  assert.equal(quest.objectives[0].current,0);assert.equal(quest.result,undefined);
  gate.resolve({text:'完成。'});assert.equal((await promise).ok,true);assert.equal(quest.objectives[0].current,1);
});

test('model tool argument failure can be repaired in the same scoped event turn',async()=>{
  const h=runtime(),{quest}=setup(h);await open(h);
  h.responses.push(tool('resolve_quest_event',{...completion,choices:['继续发奖']}),tool('resolve_quest_event',completion),{text:'完成。'});
  assert.equal((await h.c.QuestEvents.run('敲门')).ok,true);assert.equal(quest.result.events.length,1);
  assert.ok(h.events.some(e=>e.name==='npc-tool-result' && e.data.detail.result.status==='REJECTED'));
});

test('diagnostic failures do not turn a committed task event into a reported failure',async()=>{
  const h=runtime(),{quest}=setup(h);h.c.GameLogger.debug=()=>{throw Error('log failure');};
  assert.equal((await open(h)).ok,true);h.responses.push(tool('resolve_quest_event',completion),{text:'完成。'});
  assert.equal((await h.c.QuestEvents.run('敲门')).ok,true);assert.equal(quest.objectives[0].current,1);
});

function returnObjective(overrides={}) {
  return {id:'return',text:'把找到的钥匙交还给林婶。',type:'deliver',actionId:'return-keys',locations:['Street'],areas:['food_stall'],required:1,prerequisites:['visit'],...overrides};
}

test('legacy return step becomes ready without a second scene, but requires correct location and recipient',async()=>{
  const h=runtime(),args=questArgs();args.objectives.push(returnObjective());
  const {quest}=setup(h,args);quest.objectives[0].current=1;quest.objectives[0].completed=true; // saved off-screen result
  assert.equal(quest.status,'active');assert.equal(h.c.TaskEngine.readyForNPC('lin').length,1);
  assert.equal(quest.status,'ready_to_turn_in');assert.equal(quest.objectives[1].completed,false);
  assert.equal(h.c.TaskEngine.eligibleObjectives().length,0);
  assert.equal(h.c.TaskEngine.validateAction({questId:quest.id,objectiveId:'return',actionId:'return-keys'}).ok,false);
  h.c.State.variables.position={locationId:'Street',areaId:'street_main'};
  assert.equal(h.c.TaskEngine.turnIn(quest.id,{npcId:'lin'}).ok,false);assert.equal(quest.objectives[1].completed,false);
  h.c.State.variables.position={locationId:'Street',areaId:'food_stall'};
  assert.equal(h.c.TaskEngine.turnIn(quest.id,{npcId:'wrong'}).ok,false);
  assert.equal(h.c.TaskEngine.turnIn(quest.id,{npcId:'lin'}).ok,true);
  assert.equal(quest.status,'completed');assert.equal(quest.objectives[1].completed,true);
  assert.equal(h.calls.length,0);assert.equal(quest.result,undefined);
});

for(const [name,overrides,dependent] of [
  ['investigation',{type:'talk',text:'向林婶打听王大爷搬去了哪里'},false],
  ['another person',{text:'把钥匙交还给王大爷。'},false],
  ['recipient only mentioned',{type:'talk',text:'告诉王大爷林婶的情况'},false],
  ['another area',{areas:['street_main']},false],
  ['intermediate return',{},true],
  ['repeated delivery',{required:2},false]
])test(name+' remains a real objective rather than being silently completed on delivery',()=>{
  const h=runtime(),args=questArgs();args.objectives.push(returnObjective(overrides));
  if(dependent)args.objectives.push({...args.objectives[0],id:'followup',prerequisites:['return']});
  const {quest}=setup(h,args);quest.objectives[0].current=1;quest.objectives[0].completed=true;
  h.c.TaskEngine.recompute(quest);
  assert.equal(h.c.TaskEngine.isTurnInObjective(quest,quest.objectives[1]),false);
  assert.equal(quest.status,'active');assert.equal(h.c.TaskEngine.turnIn(quest.id,{npcId:'lin'}).ok,false);
});

test('an old save already inside a return event renders a dialogue route without another model request',async()=>{
  const h=runtime(),args=questArgs();args.objectives.push(returnObjective());const {quest}=setup(h,args);
  quest.objectives[0].completed=true;quest.objectives[0].current=1;
  h.c.State.variables.activeQuestEvent={questId:quest.id,objectiveId:'return',actionId:'return-keys'};
  h.c.State.passage='QuestEvent';
  const root=new Element('section');h.c.QuestEvents.render(root);
  await new Promise(r=>setTimeout(r,5));
  assert.match(root.textContent,/前往对话交付/);assert.equal(h.calls.length,0);
  const result=await h.c.QuestEvents.run();assert.equal(result.ok,false);assert.equal(h.calls.length,0);
});

test('escaped prose becomes real newlines in scenes and evidence while raw tool logs stay intact',async()=>{
  const h=runtime(),{quest}=setup(h);
  const text='第一段。\\n\\n第二段。\\r\\n第三段。<br>第四段。<img src=x onerror=evil()> <<run evil()>>';
  h.responses.push(tool('present_quest_scene',{description:text,choices:['先问候\\n再观察']}),{text:'请选择。'});
  assert.equal((await h.c.QuestEvents.run()).ok,true);
  const expected='第一段。\n\n第二段。\n第三段。\n第四段。<img src=x onerror=evil()> <<run evil()>>';
  assert.equal(quest.eventScenes.visit.description,expected);
  assert.equal(quest.eventScenes.visit.choices[0],'先问候\n再观察');
  h.responses.push(tool('resolve_quest_event',{...completion,description:text,summary:'确认平安\\n已告别'}),{text:'结束。'});
  assert.equal((await h.c.QuestEvents.run('问候')).ok,true);
  assert.equal(quest.result.events[0].description,expected);assert.equal(quest.result.events[0].summary,'确认平安\n已告别');
  const root=new Element('section');h.c.QuestEvents.render(root);await new Promise(r=>setTimeout(r,5));
  assert.equal(root.textContent.includes(expected),true);
  const raw=h.events.find(e=>e.name==='npc-tool-call' && e.data.detail.name==='present_quest_scene');
  assert.equal(raw.data.detail.arguments.description,text);
  assert.equal(h.c.normalizeLLMText(expected),expected);
});
