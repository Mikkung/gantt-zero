const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
function loadTs(filename, overrides={}, cache=new Map()) {
  const file=path.resolve(filename); if(cache.has(file))return cache.get(file).exports;
  const mod=new Module(file,module);cache.set(file,mod);mod.filename=file;mod.paths=module.paths;
  mod.require=name=>{
    if(Object.hasOwn(overrides,name))return overrides[name];
    if(name.endsWith('.css'))return {__esModule:true,default:{}};
    if(name.startsWith('.')){const target=path.resolve(path.dirname(file),name);return loadTs(target+(['.ts','.tsx'].find(extension=>fs.existsSync(target+extension))??'.ts'),overrides,cache);}
    return require(name);
  };
  mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,file);
  return mod.exports;
}
const ids={admin:'10000000-0000-0000-0000-000000000001',user:'10000000-0000-0000-0000-000000000002',manager:'10000000-0000-0000-0000-000000000003',other:'10000000-0000-0000-0000-000000000004',
  team:'20000000-0000-0000-0000-000000000001',otherTeam:'20000000-0000-0000-0000-000000000002',a:'30000000-0000-0000-0000-000000000001',b:'30000000-0000-0000-0000-000000000002',c:'30000000-0000-0000-0000-000000000003',added:'30000000-0000-0000-0000-000000000004',excluded:'30000000-0000-0000-0000-000000000005',otherTask:'30000000-0000-0000-0000-000000000006'};
const migration=name=>fs.readFileSync('supabase/migrations/'+name,'utf8');
async function fixture(stage=1, draftTaskSupport=true, originalExclusion=true) {
  const {PGlite}=require(process.env.MONTHLY_REVIEW_PGLITE_PATH);const db=new PGlite();
  await db.exec(`CREATE ROLE authenticated;CREATE ROLE anon;CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE TABLE teams(id uuid PRIMARY KEY,name text);INSERT INTO teams VALUES('${ids.team}','Team A'),('${ids.otherTeam}','Team B');
    CREATE TABLE profiles(id uuid PRIMARY KEY,email text,display_name text,role text,team_id uuid REFERENCES teams(id));
    INSERT INTO profiles VALUES('${ids.admin}','admin@test','Admin','admin',NULL),('${ids.user}','staff@test','Staff A','user','${ids.team}'),('${ids.manager}','manager@test','Manager','manager','${ids.team}'),('${ids.other}','other@test','Staff B','user','${ids.otherTeam}');
    CREATE FUNCTION is_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT role='admin' FROM profiles WHERE id=auth.uid() $$;
    CREATE FUNCTION is_user() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT role='user' FROM profiles WHERE id=auth.uid() $$;
    CREATE FUNCTION current_employee_key() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT display_name FROM profiles WHERE id=auth.uid() $$;
    CREATE TABLE tasks(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text NOT NULL,description text,start_date date,end_date date,status text DEFAULT 'To Do',priority text DEFAULT 'Medium',progress numeric DEFAULT 0,progress_summary text,assignee text,team_id uuid,parent_id uuid REFERENCES tasks(id),is_recurring boolean DEFAULT false,recurring_type text DEFAULT 'none',recurring_interval integer,recurring_unit text,dependencies text,work_type text,output text,frequency_count numeric,frequency_unit text,time_per_occurrence_minutes numeric,weight numeric DEFAULT 0,calculated_progress numeric,task_source text DEFAULT 'as_original',counts_toward_assessment boolean DEFAULT true,include_in_ai_summary boolean DEFAULT true,created_at timestamptz DEFAULT now());
    INSERT INTO tasks(id,name,assignee,team_id,weight,progress) VALUES('${ids.a}','AS A','Staff A','${ids.team}',100,25),('${ids.b}','AS B','Staff A','${ids.team}',40,50),('${ids.c}','AS C','Staff A','${ids.team}',60,80),('${ids.otherTask}','Other AS','Staff B','${ids.otherTeam}',100,20);
    UPDATE tasks SET parent_id='${ids.a}' WHERE id IN('${ids.b}','${ids.c}');
    ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;GRANT ALL ON tasks TO authenticated;
    CREATE POLICY task_admin ON tasks FOR ALL TO authenticated USING(is_admin()) WITH CHECK(is_admin());
    CREATE POLICY task_user_select ON tasks FOR SELECT TO authenticated USING(assignee=current_employee_key());
    CREATE TABLE assessment_task_snapshots(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),task_id uuid,weight numeric);
    GRANT SELECT ON assessment_task_snapshots TO authenticated;
    INSERT INTO assessment_task_snapshots(task_id,weight) VALUES('${ids.b}',40),('${ids.c}',60);
  `);
  await db.exec(migration('20261012000000_add_user_added_progress_weight.sql'));
  await db.exec(migration('20261014000000_add_user_added_auto_weighting.sql'));
  await db.exec(migration('20261014010000_persist_existing_user_added_weight_balance.sql'));
  await db.exec(`INSERT INTO tasks(id,name,assignee,team_id,parent_id,task_source,weight,counts_toward_assessment,include_in_ai_summary,user_added_weight,progress,output,frequency_unit)
    VALUES('${ids.added}','Added work','Staff A','${ids.team}','${ids.b}','user_added',0,false,true,50,100,'Deliverable','academic_year'),('${ids.excluded}','Historical added','Staff A','${ids.team}','${ids.b}','user_added',0,false,true,50,0,'Old','semester');`);
  await db.exec(migration('20261022000000_as_revision_foundation.sql'));
  if(stage>=2)await db.exec(migration('20261022010000_as_revision_submission.sql'));
  if(stage>=3)await db.exec(migration('20261022020000_as_revision_publication.sql'));
  if(stage>=3)await db.exec(migration('20261026000000_as_revision_skip_inactive_profiles.sql'));
  if(stage>=3)await db.exec(migration('20261026010000_as_revision_delete_empty_period.sql'));
  if(stage>=3&&draftTaskSupport)await db.exec(migration('20261026020000_as_revision_task_selection_and_new_tasks.sql'));
  if(stage>=3&&draftTaskSupport)await db.exec(migration('20261026030000_as_revision_delete_unpublished_period.sql'));
  if(stage>=3&&draftTaskSupport&&originalExclusion)await db.exec(migration('20261026040000_as_revision_original_task_exclusion.sql'));
  const login=async id=>{await db.exec('RESET ROLE');await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('SET ROLE authenticated');};
  const rpc=async(name,args)=> (await db.query(`SELECT to_jsonb(${name}(${args.map((_,i)=>'$'+(i+1)).join(',')})) AS result`,args)).rows[0].result;
  await login(ids.admin);
  const period=await rpc('as_revision_save_period',[null,JSON.stringify({title:'AS 2027',year:2027,cycle:'Annual',starts_at:'2020-01-01T00:00:00Z',ends_at:'2099-01-01T00:00:00Z',eligible_profile_ids:[ids.user,ids.other],eligible_team_ids:[]}),0]);
  return {db,login,rpc,period};
}
test('milestone 1: foundation authorization, immutable baseline and separate revision window',{skip:!process.env.MONTHLY_REVIEW_PGLITE_PATH},async()=>{
  const {db,login,rpc,period}=await fixture();
  try {
    const before=(await db.query('SELECT * FROM tasks ORDER BY id')).rows;
    await login(ids.manager);await assert.rejects(rpc('as_revision_set_period_status',[period.id,'open',0]),/Only admins/);
    await login(ids.admin);const opened=await rpc('as_revision_set_period_status',[period.id,'open',0]);assert.equal(opened.status,'open');
    assert.deepEqual((await db.query('SELECT * FROM tasks ORDER BY id')).rows,before);
    const requests=(await db.query('SELECT * FROM as_revision_requests ORDER BY employee_id')).rows;
    assert.equal(requests.length,2);const request=requests.find(row=>row.employee_id==='Staff A');
    await login(ids.user);
    assert.equal((await db.query('SELECT * FROM as_revision_requests')).rows.length,1);
    assert.equal((await db.query('SELECT * FROM as_revision_periods')).rows.length,1);
    const workspace=await rpc('as_revision_workspace',[request.id]);assert.equal(workspace.can_edit,true);assert.equal(workspace.can_review,false);
    assert.equal(workspace.items.length,5);assert.equal(workspace.items.find(row=>row.source_task_id===ids.added).business.output,'Deliverable');
    await assert.rejects(db.query("UPDATE as_revision_items SET business='{}' WHERE request_id=$1",[request.id]),/permission denied/);
    await assert.rejects(rpc('as_revision_workspace',[requests.find(row=>row.employee_id==='Staff B').id]),/access denied/);
    await login(ids.manager);assert.equal((await db.query('SELECT * FROM as_revision_requests')).rows.length,1);
    assert.equal((await rpc('as_revision_workspace',[request.id])).can_review,true);
    await assert.rejects(rpc('as_revision_workspace',[requests.find(row=>row.employee_id==='Staff B').id]),/access denied/);
    await login(ids.admin);await rpc('as_revision_set_period_status',[period.id,'closed',opened.revision]);
    await login(ids.user);assert.equal((await rpc('as_revision_workspace',[request.id])).can_edit,false);
    await db.exec('RESET ROLE;SET ROLE anon');await assert.rejects(rpc('as_revision_workspace',[request.id]),/permission denied/);
  }finally{await db.close();}
});
test('milestone 2: owner-only drafts, effective totals, comparison and immutable submission',{skip:!process.env.MONTHLY_REVIEW_PGLITE_PATH},async()=>{
  const {db,login,rpc,period}=await fixture(2);
  try {
    await rpc('as_revision_set_period_status',[period.id,'open',0]);
    const request=(await db.query("SELECT * FROM as_revision_requests WHERE employee_id='Staff A'")).rows[0];
    const before=(await db.query('SELECT * FROM tasks ORDER BY id')).rows;
    await login(ids.user);let workspace=await rpc('as_revision_workspace',[request.id]);
    const items=workspace.items.map(item=>({...item,business:{...item.business}}));
    const added=items.find(item=>item.source_task_id===ids.added);added.action='promote';added.business.weight=40;added.business.name='Promoted official job';
    const helpers=loadTs('utils/asRevision.ts',{'./supabase':{supabase:{}}});
    const valid=helpers.validateRevision(items,workspace.request.baseline);assert.deepEqual(valid.errors,[]);assert.equal(valid.total,100);assert.equal(valid.before,100);
    assert.ok(helpers.revisionDifferences(added).some(([key])=>key==='name'));
    await login(ids.other);await assert.rejects(rpc('as_revision_save_draft',[request.id,0,JSON.stringify(items)]),/Only the owner/);
    await login(ids.user);
    const saved=await rpc('as_revision_save_draft',[request.id,0,JSON.stringify(items)]);assert.equal(saved.draft_revision,1);
    await assert.rejects(rpc('as_revision_save_draft',[request.id,0,JSON.stringify(items)]),/Draft changed/);
    await assert.rejects(rpc('as_revision_submit',[request.id,1,false]),/Confirm/);
    const submitted=await rpc('as_revision_submit',[request.id,1,true]);assert.equal(submitted.current_version,1);assert.equal(submitted.status,'submitted');
    const version=(await rpc('as_revision_workspace',[request.id])).versions[0];assert.equal(version.items.find(item=>item.id===added.id).business.weight,40);
    await assert.rejects(rpc('as_revision_save_draft',[request.id,submitted.draft_revision,JSON.stringify(items)]),/Only the owner/);
    await assert.rejects(db.query("UPDATE as_revision_versions SET items='[]' WHERE id=$1",[version.id]),/permission denied/);
    await login(ids.admin);assert.deepEqual((await db.query('SELECT * FROM tasks ORDER BY id')).rows,before);
    await db.exec('RESET ROLE');await assert.rejects(db.query("UPDATE as_revision_versions SET items='[]' WHERE id=$1",[version.id]),/append-only/);
  }finally{await db.close();}
});
module.exports={fixture,ids,loadTs};

test('upgrading existing submitted revisions backfills immutable sources and preserves versions/live tasks/FK retention',{skip:!process.env.MONTHLY_REVIEW_PGLITE_PATH},async()=>{
  const {db,login,rpc,period}=await fixture(3,false);
  try{
    await rpc('as_revision_set_period_status',[period.id,'open',0]);const request=(await db.query("SELECT * FROM as_revision_requests WHERE employee_id='Staff A'")).rows[0];
    await login(ids.user);await rpc('as_revision_submit',[request.id,0,true]);const oldWorkspace=await rpc('as_revision_workspace',[request.id]);
    await login(ids.admin);await db.query("UPDATE tasks SET name='Live change after baseline' WHERE id=$1",[ids.added]);
    const before=(await db.query('SELECT * FROM tasks ORDER BY id')).rows;
    await db.exec('RESET ROLE');await db.exec(migration('20261026020000_as_revision_task_selection_and_new_tasks.sql'));
    await login(ids.user);const upgraded=await rpc('as_revision_workspace',[request.id]);assert.deepEqual(upgraded.request.baseline,oldWorkspace.request.baseline);assert.deepEqual(upgraded.versions,oldWorkspace.versions);
    const item=upgraded.items.find(row=>row.source_task_id===ids.added);assert.equal(item.is_new,false);assert.equal(item.existing_task_id,ids.added);assert.equal(item.source_snapshot.name,'Added work');
    await login(ids.admin);assert.deepEqual((await db.query('SELECT * FROM tasks ORDER BY id')).rows,before);
    await db.exec('RESET ROLE');await db.query("SELECT set_config('request.jwt.claim.sub','',false)");await assert.rejects(db.query('DELETE FROM tasks WHERE id=$1',[ids.added]),/foreign key/);
  }finally{await db.close();}
});

test('new revision proposals and late added selections remain draft-only, publish once and never enter old assessments',{skip:!process.env.MONTHLY_REVIEW_PGLITE_PATH},async()=>{
  const {db,login,rpc,period}=await fixture(3);
  try{
    await rpc('as_revision_set_period_status',[period.id,'open',0]);
    const request=(await db.query("SELECT * FROM as_revision_requests WHERE employee_id='Staff A'")).rows[0];
    await login(ids.user);
    const late=await rpc('create_user_added_tasks',[JSON.stringify([{name:'Created after opening',parent_id:ids.b,progress:20}])]);
    let workspace=await rpc('as_revision_workspace',[request.id]);
    assert.equal(workspace.available_user_added_tasks.length,1);assert.equal(workspace.available_user_added_tasks[0].id,late.id);
    const synced=await rpc('as_revision_sync_added_tasks',[request.id,0]);assert.equal(synced.draft_revision,1);
    assert.equal((await rpc('as_revision_sync_added_tasks',[request.id,1])).draft_revision,1);
    await assert.rejects(rpc('as_revision_add_task',[request.id,0,'Stale',null,true]),/Draft changed/);
    await assert.rejects(rpc('as_revision_add_task',[request.id,1,'Wrong parent',ids.otherTask,false]),/own revision/);
    await assert.rejects(rpc('as_revision_add_task',[request.id,1,'Missing parent',null,false]),/own revision/);
    await login(ids.admin);const tasksBefore=(await db.query('SELECT * FROM tasks ORDER BY id')).rows;
    await login(ids.user);
    let saved=await rpc('as_revision_add_task',[request.id,1,'New official AS',null,true]);
    saved=await rpc('as_revision_add_task',[request.id,saved.draft_revision,'New supporting work',ids.b,false]);
    saved=await rpc('as_revision_add_task',[request.id,saved.draft_revision,'Not carried forward',null,true]);
    workspace=await rpc('as_revision_workspace',[request.id]);assert.deepEqual(workspace.request.baseline,request.baseline);
    const proposal=workspace.items.find(item=>item.business.name==='New official AS');
    const supporting=workspace.items.find(item=>item.business.name==='New supporting work');
    const excluded=workspace.items.find(item=>item.business.name==='Not carried forward');
    assert.equal(proposal.is_new,true);assert.equal(proposal.existing_task_id,null);assert.deepEqual(proposal.original_business,{});
    proposal.business.weight=20;workspace.items.find(item=>item.source_task_id===ids.c).business.weight=40;
    workspace.items.find(item=>item.source_task_id===late.id).action='keep';
    workspace.items.find(item=>item.source_task_id===ids.added).action='keep';excluded.action='exclude';
    const validation=loadTs('utils/asRevision.ts',{'./supabase':{supabase:{}}}).validateRevision(workspace.items,workspace.request.baseline);assert.deepEqual(validation.errors,[]);assert.equal(validation.total,100);
    saved=await rpc('as_revision_save_draft',[request.id,saved.draft_revision,JSON.stringify(workspace.items)]);
    await rpc('as_revision_submit',[request.id,saved.draft_revision,true]);
    await assert.rejects(rpc('as_revision_add_task',[request.id,saved.draft_revision,'Locked',null,true]),/Only the owner/);
    await login(ids.admin);assert.deepEqual((await db.query('SELECT * FROM tasks ORDER BY id')).rows,tasksBefore);
    await login(ids.manager);const required=workspace.items.filter(item=>['original','promote'].includes(item.action));
    for(const item of required.slice(0,-1))await rpc('as_revision_review',[request.id,item.id,'approve','Approved',1]);
    await login(ids.admin);await db.query("INSERT INTO tasks(id,name,assignee,weight) VALUES($1,'Conflicting planned ID','Staff B',0)",[proposal.source_task_id]);
    await login(ids.manager);await assert.rejects(rpc('as_revision_review',[request.id,required.at(-1).id,'approve','Final',1]),/planned new task ID/);
    assert.equal((await rpc('as_revision_workspace',[request.id])).publication,null);
    await login(ids.admin);assert.equal((await db.query('SELECT * FROM tasks WHERE id=$1',[supporting.source_task_id])).rows.length,0);
    await db.exec('RESET ROLE');await db.query("SELECT set_config('request.jwt.claim.sub','',false)");await db.query('DELETE FROM tasks WHERE id=$1',[proposal.source_task_id]);
    await login(ids.manager);await rpc('as_revision_review',[request.id,required.at(-1).id,'approve','Final',1]);
    workspace=await rpc('as_revision_workspace',[request.id]);assert.equal(workspace.request.status,'published');
    await login(ids.admin);const tasksAfter=(await db.query('SELECT * FROM tasks ORDER BY id')).rows;
    assert.equal(tasksAfter.length,tasksBefore.length+2);assert.equal(tasksAfter.some(task=>task.id===excluded.source_task_id),false);
    const official=tasksAfter.find(task=>task.id===proposal.source_task_id);assert.equal(official.task_source,'as_original');assert.equal(Number(official.weight),20);assert.equal(official.counts_toward_assessment,true);assert.equal(Number(official.progress),0);assert.equal(official.status,'To Do');
    const activity=tasksAfter.find(task=>task.id===supporting.source_task_id);assert.equal(activity.task_source,'user_added');assert.equal(Number(activity.weight),0);assert.equal(activity.counts_toward_assessment,false);assert.equal(activity.include_in_ai_summary,true);assert.equal(activity.parent_id,ids.b);assert.equal(activity.assignee,'Staff A');
    assert.equal(workspace.items.find(item=>item.id===proposal.id).existing_task_id,official.id);
    const history=loadTs('utils/asRevisionHistory.ts');
    const oldTasks=history.tasksAtAssessmentPeriod(tasksAfter,{self_start_at:new Date(Date.parse(workspace.publication.published_at)-1000).toISOString()});
    assert.equal(oldTasks.some(task=>task.id===official.id||task.id===activity.id),false);assert.equal(Number(oldTasks.find(task=>task.id===ids.c).weight),60);
    assert.equal(history.tasksAtAssessmentPeriod([official],{self_start_at:new Date(Date.parse(workspace.publication.published_at)+1000).toISOString()}).length,1);
    assert.deepEqual((await db.query('SELECT task_id,weight FROM assessment_task_snapshots ORDER BY task_id')).rows,[{task_id:ids.b,weight:'40'},{task_id:ids.c,weight:'60'}]);
    await rpc('as_revision_publish',[request.id,1]);assert.equal((await db.query('SELECT * FROM tasks')).rows.length,tasksAfter.length);
    await db.exec('RESET ROLE');await db.query("SELECT set_config('request.jwt.claim.sub','',false)");
    await assert.rejects(db.query('DELETE FROM tasks WHERE id=$1',[official.id]),/foreign key/);
  }finally{await db.close();}
});

test('draft additions enforce ownership, window and whole-return scope while submitted versions remain immutable',{skip:!process.env.MONTHLY_REVIEW_PGLITE_PATH},async()=>{
  const {db,login,rpc,period}=await fixture(3);
  try{
    const opened=await rpc('as_revision_set_period_status',[period.id,'open',0]);const request=(await db.query("SELECT * FROM as_revision_requests WHERE employee_id='Staff A'")).rows[0];
    for(const actor of [ids.other,ids.manager,ids.admin]){await login(actor);await assert.rejects(rpc('as_revision_add_task',[request.id,0,'Not mine',null,true]),/Only the owner/);await assert.rejects(rpc('as_revision_sync_added_tasks',[request.id,0]),/Only the owner/);}
    await db.exec('RESET ROLE;SET ROLE anon');await assert.rejects(rpc('as_revision_add_task',[request.id,0,'Anonymous',null,true]),/permission denied/);
    await login(ids.user);await rpc('as_revision_submit',[request.id,0,true]);
    let workspace=await rpc('as_revision_workspace',[request.id]);const version=workspace.versions[0];
    await login(ids.manager);await rpc('as_revision_review',[request.id,workspace.items[0].id,'return','Correct this item',1]);
    await login(ids.user);workspace=await rpc('as_revision_workspace',[request.id]);
    await assert.rejects(rpc('as_revision_add_task',[request.id,workspace.request.draft_revision,'Partial scope',null,true]),/whole configuration/);
    await login(ids.user);await rpc('as_revision_submit',[request.id,workspace.request.draft_revision,true]);
    await login(ids.manager);await rpc('as_revision_review',[request.id,null,'return','Rework full AS',2]);
    await login(ids.admin);await rpc('as_revision_set_period_status',[period.id,'closed',opened.revision]);
    await login(ids.user);workspace=await rpc('as_revision_workspace',[request.id]);await assert.rejects(rpc('as_revision_add_task',[request.id,workspace.request.draft_revision,'Closed window',null,true]),/Only the owner/);
    await login(ids.admin);await rpc('as_revision_admin_exception',[request.id,'extend','Allow new job','2099-01-01']);
    await login(ids.user);workspace=await rpc('as_revision_workspace',[request.id]);await rpc('as_revision_add_task',[request.id,workspace.request.draft_revision,'Allowed after return',null,true]);
    workspace=await rpc('as_revision_workspace',[request.id]);assert.deepEqual(workspace.versions.find(row=>row.version_no===1),version);assert.equal(workspace.items.find(item=>item.business.name==='Allowed after return').review_status,'returned');
  }finally{await db.close();}
});

test('period deletion eligibility rejects open periods and every existing request, including cancelled history',()=>{
  const {canDeleteRevisionPeriod}=loadTs('utils/asRevision.ts',{'./supabase':{supabase:{}}});
  assert.equal(canDeleteRevisionPeriod({id:'p',status:'draft'},[]),true);
  assert.equal(canDeleteRevisionPeriod({id:'p',status:'closed'},[{period_id:'other'}]),true);
  assert.equal(canDeleteRevisionPeriod({id:'p',status:'open'},[]),false);
  assert.equal(canDeleteRevisionPeriod({id:'p',status:'draft'},[{period_id:'p',status:'cancelled'}]),false);
});

test('admin deletion is version-checked, serialized with opening, and never deletes revision/task history',{skip:!process.env.MONTHLY_REVIEW_PGLITE_PATH},async()=>{
  const {db,login,rpc,period}=await fixture(3);
  try {
    const tasksBefore=(await db.query('SELECT * FROM tasks ORDER BY id')).rows;
    for(const user of [ids.user,ids.manager]){await login(user);await assert.rejects(rpc('as_revision_delete_period',[period.id,0]),/Only admins/);}
    await db.exec('RESET ROLE;SET ROLE anon');await assert.rejects(rpc('as_revision_delete_period',[period.id,0]),/permission denied/);
    await login(ids.admin);await assert.rejects(db.query('DELETE FROM as_revision_periods WHERE id=$1',[period.id]),/permission denied/);
    await assert.rejects(rpc('as_revision_delete_period',[period.id,null]),/Period changed/);
    const changed=await rpc('as_revision_save_period',[period.id,JSON.stringify({...period,title:'Updated title'}),0]);
    await assert.rejects(rpc('as_revision_delete_period',[period.id,0]),/Period changed/);
    assert.equal(await rpc('as_revision_delete_period',[period.id,changed.revision]),period.id);
    await assert.rejects(rpc('as_revision_delete_period',[period.id,changed.revision]),/Period not found/);
    const next=await rpc('as_revision_save_period',[null,JSON.stringify({...period,title:'Keep history'}),0]);
    const opened=await rpc('as_revision_set_period_status',[next.id,'open',0]);
    const requests=(await db.query('SELECT * FROM as_revision_requests ORDER BY id')).rows;
    const items=(await db.query('SELECT * FROM as_revision_items ORDER BY id')).rows;
    await assert.rejects(rpc('as_revision_delete_period',[next.id,opened.revision]),/Cannot delete/);
    const closed=await rpc('as_revision_set_period_status',[next.id,'closed',opened.revision]);
    for(const request of requests)await rpc('as_revision_admin_exception',[request.id,'cancel','No longer needed',null]);
    await assert.rejects(rpc('as_revision_delete_period',[next.id,closed.revision]),/Cannot delete/);
    assert.deepEqual((await db.query('SELECT * FROM tasks ORDER BY id')).rows,tasksBefore);
    assert.deepEqual((await db.query('SELECT * FROM as_revision_items ORDER BY id')).rows,items);
    assert.equal((await db.query('SELECT * FROM as_revision_requests')).rows.length,requests.length);
    const empty=await rpc('as_revision_save_period',[null,JSON.stringify({...period,title:'Empty closed'}),0]);
    const emptyClosed=await rpc('as_revision_set_period_status',[empty.id,'closed',0]);
    assert.equal(await rpc('as_revision_delete_period',[empty.id,emptyClosed.revision]),empty.id);
  }finally{await db.close();}
});

test('closed unpublished cleanup deletes only its revision tree and releases employee eligibility without touching tasks or assessments',{skip:!process.env.MONTHLY_REVIEW_PGLITE_PATH},async()=>{
  const {db,login,rpc,period}=await fixture(3);
  try{
    await rpc('as_revision_set_period_status',[period.id,'open',0]);
    const requests=(await db.query('SELECT * FROM as_revision_requests ORDER BY id')).rows;
    const employee=requests.find(row=>row.employee_id==='Staff A');const other=requests.find(row=>row.employee_id==='Staff B');
    await login(ids.user);await rpc('as_revision_add_task',[employee.id,0,'Draft only activity',ids.b,false]);
    await rpc('as_revision_submit',[employee.id,1,true]);
    await login(ids.admin);await rpc('as_revision_review',[employee.id,null,'return','Test correction',1]);
    await login(ids.user);let workspace=await rpc('as_revision_workspace',[employee.id]);
    await rpc('as_revision_submit',[employee.id,workspace.request.draft_revision,true]);
    await login(ids.admin);await rpc('as_revision_admin_exception',[other.id,'cancel','Move to separate test period',null]);
    const separate=await rpc('as_revision_save_period',[null,JSON.stringify({...period,title:'Keep this period',eligible_profile_ids:[ids.other]}),0]);
    await rpc('as_revision_set_period_status',[separate.id,'open',0]);
    const unrelatedRequests=(await db.query('SELECT * FROM as_revision_requests WHERE period_id=$1 ORDER BY id',[separate.id])).rows;
    const unrelatedItems=(await db.query('SELECT * FROM as_revision_items WHERE request_id=$1 ORDER BY id',[unrelatedRequests[0].id])).rows;
    const tasksBefore=(await db.query('SELECT * FROM tasks ORDER BY id')).rows;
    const snapshotsBefore=(await db.query('SELECT * FROM assessment_task_snapshots ORDER BY id')).rows;
    await db.exec(`RESET ROLE; CREATE TABLE task_self_evaluations(id integer PRIMARY KEY,answer jsonb);
      INSERT INTO task_self_evaluations VALUES(1,'{"score":5}');
      CREATE TABLE attribute_self_evaluations(id integer PRIMARY KEY,answer jsonb);
      INSERT INTO attribute_self_evaluations VALUES(1,'{"score":4}');
      CREATE TABLE self_evaluation_submissions(id integer PRIMARY KEY,status text);
      INSERT INTO self_evaluation_submissions VALUES(1,'submitted');`);
    await login(ids.admin);
    const closed=await rpc('as_revision_set_period_status',[period.id,'closed',1]);
    const preview=await rpc('as_revision_period_deletion_preview',[period.id]);
    assert.equal(preview.can_delete,true);assert.equal(preview.counts.employees,2);
    assert.equal(preview.counts.submitted,1);assert.equal(preview.counts.cancelled,1);assert.equal(preview.counts.versions,2);
    assert.ok(preview.counts.reviews>=4);assert.equal(preview.counts.publications,0);
    assert.equal(await rpc('as_revision_delete_unpublished_period',[period.id,closed.revision,period.title,preview.contents_token]),period.id);
    for(const table of ['as_revision_requests','as_revision_items','as_revision_versions','as_revision_reviews']){
      const rows=(await db.query(`SELECT * FROM ${table} ORDER BY id`)).rows;
      assert.equal(rows.some(row=>row.period_id===period.id||requests.some(request=>request.id===row.request_id)),false,table);
    }
    assert.deepEqual((await db.query('SELECT * FROM as_revision_requests WHERE period_id=$1 ORDER BY id',[separate.id])).rows,unrelatedRequests);
    assert.deepEqual((await db.query('SELECT * FROM as_revision_items WHERE request_id=$1 ORDER BY id',[unrelatedRequests[0].id])).rows,unrelatedItems);
    assert.deepEqual((await db.query('SELECT * FROM tasks ORDER BY id')).rows,tasksBefore);
    assert.deepEqual((await db.query('SELECT * FROM assessment_task_snapshots ORDER BY id')).rows,snapshotsBefore);
    await db.exec('RESET ROLE');assert.equal((await db.query('SELECT count(*)::int AS n FROM as_revision_deletion_guards')).rows[0].n,0);
    assert.deepEqual((await db.query('SELECT * FROM task_self_evaluations')).rows,[{id:1,answer:{score:5}}]);
    assert.deepEqual((await db.query('SELECT * FROM attribute_self_evaluations')).rows,[{id:1,answer:{score:4}}]);
    assert.deepEqual((await db.query('SELECT * FROM self_evaluation_submissions')).rows,[{id:1,status:'submitted'}]);
    await login(ids.admin);
    const fresh=await rpc('as_revision_save_period',[null,JSON.stringify({...period,title:'Fresh employee baseline',eligible_profile_ids:[ids.user]}),0]);
    await rpc('as_revision_set_period_status',[fresh.id,'open',0]);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM as_revision_requests WHERE period_id=$1',[fresh.id])).rows[0].n,1);
    await assert.rejects(rpc('as_revision_delete_unpublished_period',[period.id,closed.revision,period.title,preview.contents_token]),/Period not found/);
  }finally{await db.close();}
});

test('cleanup requires admin, a closed period, exact title and a current preview; append-only/client permissions stay intact',{skip:!process.env.MONTHLY_REVIEW_PGLITE_PATH},async()=>{
  const {db,login,rpc,period}=await fixture(3);
  try{
    for(const user of [ids.user,ids.manager]){
      await login(user);await assert.rejects(rpc('as_revision_period_deletion_preview',[period.id]),/Only admins/);
      await assert.rejects(rpc('as_revision_delete_unpublished_period',[period.id,0,period.title,'fake']),/Only admins/);
    }
    await db.exec('RESET ROLE;SET ROLE anon');
    await assert.rejects(rpc('as_revision_period_deletion_preview',[period.id]),/permission denied/);
    await assert.rejects(rpc('as_revision_delete_unpublished_period',[period.id,0,period.title,'fake']),/permission denied/);
    await login(ids.admin);let preview=await rpc('as_revision_period_deletion_preview',[period.id]);
    assert.equal(preview.can_delete,false);assert.match(preview.blocked_reason,/Close/);
    await rpc('as_revision_set_period_status',[period.id,'open',0]);
    const request=(await db.query("SELECT * FROM as_revision_requests WHERE employee_id='Staff A'")).rows[0];
    await login(ids.user);await rpc('as_revision_submit',[request.id,0,true]);
    await login(ids.admin);preview=await rpc('as_revision_period_deletion_preview',[period.id]);
    await assert.rejects(rpc('as_revision_delete_unpublished_period',[period.id,1,period.title,preview.contents_token]),/Close/);
    const closed=await rpc('as_revision_set_period_status',[period.id,'closed',1]);preview=await rpc('as_revision_period_deletion_preview',[period.id]);
    await assert.rejects(rpc('as_revision_delete_unpublished_period',[period.id,null,period.title,preview.contents_token]),/Period changed/);
    await assert.rejects(rpc('as_revision_delete_unpublished_period',[period.id,closed.revision,'Wrong title',preview.contents_token]),/exact period title/);
    await assert.rejects(rpc('as_revision_delete_unpublished_period',[period.id,closed.revision,period.title,null]),/Revision data changed/);
    await assert.rejects(db.query('INSERT INTO as_revision_deletion_guards VALUES($1,txid_current(),$2)',[period.id,ids.admin]),/permission denied/);
    for(const table of ['as_revision_versions','as_revision_reviews','as_revision_items','as_revision_requests'])await assert.rejects(db.query(`DELETE FROM ${table}`),/permission denied/);
    await db.exec('RESET ROLE');
    for(const table of ['as_revision_versions','as_revision_reviews']){
      await assert.rejects(db.query(`DELETE FROM ${table} WHERE request_id=$1`,[request.id]),/append-only/);
      await assert.rejects(db.query(`UPDATE ${table} SET request_id=request_id WHERE request_id=$1`,[request.id]),/append-only/);
    }
    await login(ids.admin);
    // Comments do not bump period.revision or request.draft_revision, but must invalidate the preview.
    await rpc('as_revision_review',[request.id,null,'comment','Added after preview',1]);
    await assert.rejects(rpc('as_revision_delete_unpublished_period',[period.id,closed.revision,period.title,preview.contents_token]),/Revision data changed/);
    preview=await rpc('as_revision_period_deletion_preview',[period.id]);
    const item=(await rpc('as_revision_workspace',[request.id])).items.find(row=>row.action==='original');
    await rpc('as_revision_review',[request.id,item.id,'approve','Partial approval',1]);
    await assert.rejects(rpc('as_revision_delete_unpublished_period',[period.id,closed.revision,period.title,preview.contents_token]),/Revision data changed/);
    preview=await rpc('as_revision_period_deletion_preview',[period.id]);
    await rpc('as_revision_set_period_status',[period.id,'open',closed.revision]);
    await assert.rejects(rpc('as_revision_delete_unpublished_period',[period.id,closed.revision,period.title,preview.contents_token]),/Period changed/);
  }finally{await db.close();}
});

test('cleanup never removes a mixed period after one employee publishes, even with misleading request status',{skip:!process.env.MONTHLY_REVIEW_PGLITE_PATH},async()=>{
  const {db,login,rpc,period}=await fixture(3);
  try{
    await rpc('as_revision_set_period_status',[period.id,'open',0]);
    const request=(await db.query("SELECT * FROM as_revision_requests WHERE employee_id='Staff A'")).rows[0];
    await login(ids.user);await rpc('as_revision_submit',[request.id,0,true]);
    await login(ids.admin);const closed=await rpc('as_revision_set_period_status',[period.id,'closed',1]);
    const before=await rpc('as_revision_period_deletion_preview',[period.id]);assert.equal(before.can_delete,true);
    const workspace=await rpc('as_revision_workspace',[request.id]);
    for(const item of workspace.items.filter(item=>item.action==='original'))await rpc('as_revision_review',[request.id,item.id,'approve','',1]);
    let preview=await rpc('as_revision_period_deletion_preview',[period.id]);
    assert.equal(preview.can_delete,false);assert.equal(preview.counts.published,1);assert.equal(preview.counts.publications,1);
    const tasks=(await db.query('SELECT * FROM tasks ORDER BY id')).rows;
    await assert.rejects(rpc('as_revision_delete_unpublished_period',[period.id,closed.revision,period.title,before.contents_token]),/published/);
    await db.exec('RESET ROLE');await assert.rejects(db.query('DELETE FROM as_revision_publications WHERE request_id=$1',[request.id]),/append-only/);
    await db.query("UPDATE as_revision_requests SET status='cancelled',published_at=NULL,published_by=NULL WHERE id=$1",[request.id]);
    await login(ids.admin);preview=await rpc('as_revision_period_deletion_preview',[period.id]);
    assert.equal(preview.can_delete,false);assert.equal(preview.counts.publications,1);
    await assert.rejects(rpc('as_revision_delete_unpublished_period',[period.id,closed.revision,period.title,preview.contents_token]),/publication history/);
    assert.deepEqual((await db.query('SELECT * FROM tasks ORDER BY id')).rows,tasks);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM as_revision_requests WHERE period_id=$1',[period.id])).rows[0].n,2);
  }finally{await db.close();}
});

test('cleanup refuses linked live tasks and rolls back all history deletions if any dependency blocks it',{skip:!process.env.MONTHLY_REVIEW_PGLITE_PATH},async()=>{
  const {db,login,rpc,period}=await fixture(3);
  try{
    await rpc('as_revision_set_period_status',[period.id,'open',0]);
    const request=(await db.query("SELECT * FROM as_revision_requests WHERE employee_id='Staff A'")).rows[0];
    await login(ids.user);await rpc('as_revision_submit',[request.id,0,true]);await login(ids.admin);
    const closed=await rpc('as_revision_set_period_status',[period.id,'closed',1]);
    await db.exec("RESET ROLE;SELECT set_config('request.jwt.claim.sub','',false)");
    await db.query('UPDATE tasks SET as_revision_request_id=$1 WHERE id=$2',[request.id,ids.a]);
    await login(ids.admin);let preview=await rpc('as_revision_period_deletion_preview',[period.id]);
    assert.equal(preview.can_delete,false);assert.match(preview.blocked_reason,/live tasks/);
    await assert.rejects(rpc('as_revision_delete_unpublished_period',[period.id,closed.revision,period.title,preview.contents_token]),/live tasks/);
    await db.exec("RESET ROLE;SELECT set_config('request.jwt.claim.sub','',false)");
    await db.query('UPDATE tasks SET as_revision_request_id=NULL WHERE id=$1',[ids.a]);
    await db.exec('CREATE TABLE cleanup_dependency_test(request_id uuid REFERENCES as_revision_requests(id))');
    await db.query('INSERT INTO cleanup_dependency_test VALUES($1)',[request.id]);
    const tables=['as_revision_periods','as_revision_requests','as_revision_items','as_revision_versions','as_revision_reviews','tasks','assessment_task_snapshots'];
    const before={};for(const table of tables)before[table]=(await db.query(`SELECT * FROM ${table} ORDER BY id`)).rows;
    await login(ids.admin);preview=await rpc('as_revision_period_deletion_preview',[period.id]);assert.equal(preview.can_delete,true);
    await assert.rejects(rpc('as_revision_delete_unpublished_period',[period.id,closed.revision,period.title,preview.contents_token]),/foreign key/);
    await db.exec('RESET ROLE');
    for(const table of tables)assert.deepEqual((await db.query(`SELECT * FROM ${table} ORDER BY id`)).rows,before[table],table);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM as_revision_deletion_guards')).rows[0].n,0);
    await assert.rejects(db.query('DELETE FROM as_revision_versions WHERE request_id=$1',[request.id]),/append-only/);
    await db.exec('DROP TABLE cleanup_dependency_test');await login(ids.admin);
    preview=await rpc('as_revision_period_deletion_preview',[period.id]);
    assert.equal(await rpc('as_revision_delete_unpublished_period',[period.id,closed.revision,period.title,preview.contents_token]),period.id);
  }finally{await db.close();}
});

test('AS revision employee choices exclude inactive users but retain legacy/null activation flags',()=>{
  const {isEligibleRevisionEmployee}=loadTs('utils/asRevision.ts',{'./supabase':{supabase:{}}});
  for(const flag of [undefined,null,true])assert.equal(isEligibleRevisionEmployee({role:'user',is_active:flag}),true);
  assert.equal(isEligibleRevisionEmployee({role:'user',is_active:false}),false);
  for(const role of ['admin','manager'])assert.equal(isEligibleRevisionEmployee({role,is_active:true}),false);
  assert.match(fs.readFileSync('components/as-revisions/AsRevision.tsx','utf8'),/setPeople\(u\.filter\(isEligibleRevisionEmployee\)\)/);
});

test('opening skips inactive employees for team and explicit eligibility, including stale saved choices',{skip:!process.env.MONTHLY_REVIEW_PGLITE_PATH},async()=>{
  const {db,login,rpc,period}=await fixture(3);
  try{
    await db.exec('RESET ROLE');
    await db.exec('ALTER TABLE profiles ADD COLUMN is_active boolean DEFAULT true');
    await db.query('UPDATE profiles SET is_active=false WHERE id=$1',[ids.other]);
    await db.query("INSERT INTO profiles(id,display_name,role,team_id,is_active) VALUES('10000000-0000-0000-0000-000000000005','Inactive without AS','user',$1,false)",[ids.team]);
    // No task for this explicitly selected inactive employee: opening previously failed here.
    const config={...period,eligible_profile_ids:[ids.other,'10000000-0000-0000-0000-000000000005'],eligible_team_ids:[ids.team]};
    await login(ids.admin);const saved=await rpc('as_revision_save_period',[period.id,JSON.stringify(config),period.revision]);
    const before=(await db.query('SELECT * FROM tasks ORDER BY id')).rows;
    await login(ids.manager);await assert.rejects(rpc('as_revision_set_period_status',[period.id,'open',saved.revision]),/Only admins/);
    await login(ids.admin);const opened=await rpc('as_revision_set_period_status',[period.id,'open',saved.revision]);
    assert.equal(opened.status,'open');
    const requests=(await db.query('SELECT * FROM as_revision_requests')).rows;assert.equal(requests.length,1);assert.equal(requests[0].employee_profile_id,ids.user);
    assert.deepEqual((await db.query('SELECT * FROM tasks ORDER BY id')).rows,before);
    const baseline=requests[0].baseline;
    await db.exec('RESET ROLE');await db.query('UPDATE profiles SET is_active=false WHERE id=$1',[ids.user]);await login(ids.admin);
    const closed=await rpc('as_revision_set_period_status',[period.id,'closed',opened.revision]);
    await rpc('as_revision_set_period_status',[period.id,'open',closed.revision]);
    assert.deepEqual((await db.query('SELECT baseline FROM as_revision_requests')).rows,[{baseline}]);
  }finally{await db.close();}
});

test('opening still rejects active employees without AS and rolls back when no active employee remains',{skip:!process.env.MONTHLY_REVIEW_PGLITE_PATH},async()=>{
  const {db,login,rpc,period}=await fixture(3);
  try{
    await db.exec('RESET ROLE');await db.exec('ALTER TABLE profiles ADD COLUMN is_active boolean');
    await db.query("INSERT INTO profiles(id,display_name,role,team_id,is_active) VALUES('10000000-0000-0000-0000-000000000005','Active without AS','user',$1,true)",[ids.team]);
    await login(ids.admin);
    const config={...period,eligible_profile_ids:[],eligible_team_ids:[ids.team]};
    const saved=await rpc('as_revision_save_period',[period.id,JSON.stringify(config),period.revision]);
    await assert.rejects(rpc('as_revision_set_period_status',[period.id,'open',saved.revision]),/Active without AS has no original AS jobs/);
    assert.equal((await db.query('SELECT * FROM as_revision_requests')).rows.length,0);
    await db.exec('RESET ROLE');await db.exec("UPDATE profiles SET is_active=false WHERE role='user'");await login(ids.admin);
    await assert.rejects(rpc('as_revision_set_period_status',[period.id,'open',saved.revision]),/No active eligible employees/);
    const unchanged=(await db.query('SELECT status,revision FROM as_revision_periods WHERE id=$1',[period.id])).rows[0];assert.equal(unchanged.status,'draft');assert.equal(unchanged.revision,saved.revision);
    await db.exec('RESET ROLE');await db.query('UPDATE profiles SET is_active=NULL WHERE id=$1',[ids.user]);await login(ids.admin);
    await rpc('as_revision_set_period_status',[period.id,'open',saved.revision]);
    assert.equal((await db.query('SELECT employee_profile_id FROM as_revision_requests')).rows[0].employee_profile_id,ids.user);
  }finally{await db.close();}
});

function uiHarness(workspace,profile,props,options={}){
  const slots=[];let cursor=0;let effects=[];const calls=[];const routes=[];
  const hooks={useState(initial){const index=cursor++;if(!slots[index])slots[index]={value:typeof initial==='function'?initial():initial};return [slots[index].value,value=>{slots[index].value=typeof value==='function'?value(slots[index].value):value;}];},
    useEffect(fn,deps){const index=cursor++;if(!slots[index]||deps.some((value,i)=>value!==slots[index].deps[i])){slots[index]={deps};effects.push(fn);}}};
  const client={auth:{getUser:async()=>({data:{user:{id:profile.id}}})},from(table){return {select(){return this;},eq(){return this;},order(){return this;},range(){return this;},maybeSingle:async()=>({data:profile}),then(resolve){return Promise.resolve({data:options.rows?.[table]??[]}).then(resolve);}};},
    async rpc(name,args){calls.push({name,args});if(name==='as_revision_save_draft'){workspace.items=workspace.items.map(item=>({...item,...args.item_changes.find(change=>change.id===item.id)}));workspace.request.draft_revision++;}
      if(name==='as_revision_add_task'){workspace.items.push({id:'new-proposal',request_id:workspace.request.id,source_task_id:'new-planned-id',parent_task_id:args.target_parent_id,kind:'user_added',action:args.make_official?'promote':'keep',is_new:true,original_business:{},business:{name:args.job_name,weight:0,start_date:null,end_date:null,is_recurring:false,priority:'Medium'},review_status:'pending'});workspace.request.draft_revision++;}
      if(name==='as_revision_sync_added_tasks'){for(const {id,parent_id,...business} of workspace.available_user_added_tasks??[])workspace.items.push({id:id+'-item',source_task_id:id,parent_task_id:parent_id,kind:'user_added',action:'exclude',original_business:business,business,review_status:'pending'});workspace.available_user_added_tasks=[];workspace.request.draft_revision++;}
      if(name==='as_revision_delete_period')return options.deleteError?{error:{message:options.deleteError}}:{data:args.target_period_id};
      if(name==='as_revision_period_deletion_preview')return options.previewError?{error:{message:options.previewError}}:{data:structuredClone(options.deletionPreview)};
      if(name==='as_revision_delete_unpublished_period')return options.cleanupError?{error:{message:options.cleanupError}}:{data:args.target_period_id};
      return {data:name==='as_revision_workspace'?structuredClone(workspace):workspace.request};}};
  const router={replace(path){routes.push(path);},push(path){routes.push(path);}};
  const Component=loadTs('components/as-revisions/AsRevision.tsx',{react:{...require('react'),...hooks},'next/link':{__esModule:true,default:props=>require('react').createElement('a',props)},'next/navigation':{useParams:()=>options.params??({request_id:workspace.request.id}),useRouter:()=>router},'../../utils/supabase':{supabase:client},'./supabase':{supabase:client}})[options.component??'RevisionWorkspacePage'];
  return {calls,routes,render(){cursor=0;const tree=Component(props);const pending=effects;effects=[];pending.forEach(effect=>effect());return tree;}};
}
function uiElements(tree){if(!tree||typeof tree!=='object')return [];if(Array.isArray(tree))return tree.flatMap(uiElements);return [tree,...uiElements(tree.props?.children)];}
function uiText(tree){return tree==null||typeof tree==='boolean'?'':typeof tree!=='object'?String(tree):Array.isArray(tree)?tree.map(uiText).join(''):uiText(tree.props?.children);}
function uiButton(tree,label){return uiElements(tree).find(node=>node.type==='button'&&uiText(node)===label);}
async function settleUi(harness){let tree;for(let i=0;i<8;i++){tree=harness.render();await new Promise(resolve=>setImmediate(resolve));}return tree;}

test('employee selection checkboxes are visible and new task creation uses revision RPCs only',async()=>{
  const task={id:'as',name:'Original AS',weight:100,task_source:'as_original'};
  const original={id:'original',source_task_id:'as',kind:'original',action:'original',parent_task_id:null,original_business:task,business:task,review_status:'pending'};
  const added={id:'added',source_task_id:'activity',kind:'user_added',action:'exclude',parent_task_id:'as',original_business:{name:'Existing activity',weight:0},business:{name:'Existing activity',weight:0},review_status:'pending'};
  const workspace={request:{id:'request',baseline:[task],employee_id:'Staff A',status:'draft',draft_revision:0,current_version:0},period:{title:'Annual',weight_target:100},items:[original,added],versions:[],reviews:[],publication:null,can_edit:true,can_review:false,available_user_added_tasks:[{id:'late',parent_id:'as',name:'Late activity',weight:0}]};
  const harness=uiHarness(workspace,{id:ids.user,role:'user'},{});let tree=await settleUi(harness);
  const label=uiElements(tree).find(node=>node.type==='label'&&uiText(node).trim()==='Existing activity');assert.ok(label);
  const checkbox=uiElements(label).find(node=>node.type==='input');assert.equal(checkbox.props.disabled,false);assert.equal(checkbox.props.checked,false);
  checkbox.props.onChange({target:{checked:true}});tree=harness.render();assert.equal(uiButton(tree,'Refresh user-added tasks').props.disabled,true);
  await uiButton(tree,'Save Draft').props.onClick();tree=harness.render();assert.equal(harness.calls.find(call=>call.name==='as_revision_save_draft').args.item_changes.find(item=>item.id==='added').action,'keep');
  await uiButton(tree,'Refresh user-added tasks').props.onClick();tree=harness.render();assert.ok(uiElements(tree).some(node=>node.type==='label'&&uiText(node).trim()==='Late activity'));
  uiButton(tree,'Add new task').props.onClick();tree=harness.render();
  const nameLabel=uiElements(tree).find(node=>node.type==='label'&&uiText(node).startsWith('New task name'));uiElements(nameLabel).find(node=>node.type==='input').props.onChange({target:{value:'Proposed AS job'}});tree=harness.render();
  const form=uiElements(tree).find(node=>node.type==='form'&&uiText(node).includes('Add to revision draft'));assert.ok(form);form.props.onSubmit({preventDefault(){}});tree=await settleUi(harness);
  const call=harness.calls.find(call=>call.name==='as_revision_add_task');assert.equal(call.args.job_name,'Proposed AS job');assert.equal(call.args.make_official,true);assert.equal(call.args.target_parent_id,null);
  assert.ok(uiText(tree).includes('Proposed AS job'));assert.ok(uiText(tree).includes('ยังไม่เผยแพร่เข้า Task Tracking'));
  const empty=uiHarness({...workspace,items:[original],available_user_added_tasks:[]},{id:ids.user,role:'user'},{});assert.match(uiText(await settleUi(empty)),/ยังไม่มีงาน user-added ที่จับเข้าร่าง/);
  const review=uiHarness({...workspace,can_edit:false,can_review:true},{id:ids.manager,role:'manager'},{review:true});tree=await settleUi(review);assert.equal(uiButton(tree,'Add new task'),undefined);
});

function hierarchyWorkspace(){
  const item=(id,name,weight,parent=null,extra={})=>({id,source_task_id:id+'-task',kind:'original',action:'original',parent_task_id:parent,original_business:{name,weight},business:{name,weight},review_status:'pending',...extra});
  const first=item('first','1.1 Original AS',50);
  const second=item('second','1.2 Original AS',30);
  const proposal=item('proposal','1.3 New AS',70,null,{kind:'user_added',action:'promote',is_new:true,original_business:{}});
  const supporting=item('supporting','1.1.1 Supporting activity',0,first.source_task_id,{kind:'user_added',action:'keep'});
  return {request:{id:'request',baseline:[{id:first.source_task_id,name:first.business.name,weight:60,task_source:'as_original'},{id:second.source_task_id,name:second.business.name,weight:40,task_source:'as_original'}],employee_id:'Staff A',status:'draft',draft_revision:0,current_version:0},period:{title:'Annual',weight_target:100},items:[first,second,proposal,supporting],versions:[],reviews:[],publication:null,can_edit:true,can_review:false,available_user_added_tasks:[]};
}

test('original AS exclusion removes whole branches from totals without losing saved child choices or cross-period scope',()=>{
  const helpers=loadTs('utils/asRevision.ts',{'./supabase':{supabase:{}}});
  const workspace=hierarchyWorkspace();const [parent,other,proposal,activity]=workspace.items;
  parent.action='exclude';
  assert.equal(helpers.validateRevision(workspace.items,workspace.request.baseline).total,100);
  assert.deepEqual(helpers.revisionTasks(workspace.items).map(task=>task.id),[other.source_task_id,proposal.source_task_id]);
  assert.equal(helpers.effectiveRevisionAction(activity,workspace.items),'exclude');assert.equal(activity.action,'keep');
  assert.equal(parent.business.weight,50);assert.equal(helpers.requiresRevisionApproval(parent,workspace.items),true);
  assert.equal(helpers.requiresRevisionApproval(activity,workspace.items),false);
  parent.action='original';assert.equal(helpers.effectiveRevisionAction(activity,workspace.items),'keep');assert.equal(helpers.validateRevision(workspace.items,workspace.request.baseline).total,150);
  activity.action='exclude';parent.action='exclude';parent.action='original';assert.equal(helpers.effectiveRevisionAction(activity,workspace.items),'exclude');
  const child={...parent,id:'child',source_task_id:'child-task',parent_task_id:parent.source_task_id,action:'original',business:{name:'Nested AS',weight:25}};
  proposal.parent_task_id=child.source_task_id;parent.action='exclude';workspace.items.push(child);
  assert.equal(helpers.validateRevision(workspace.items,workspace.request.baseline).total,30);
  assert.equal(helpers.requiresRevisionApproval(child,workspace.items),true);assert.equal(helpers.requiresRevisionApproval(proposal,workspace.items),false);
  assert.equal(helpers.revisionBranch(parent,workspace.items).length,4);
  parent.request_id='old-period';child.request_id='new-period';assert.equal(helpers.excludedRevisionAncestor(child,workspace.items),null);
});

test('original AS exclusion upgrades existing submissions, preserves restore values and requires removal approval before archiving a branch',{skip:!process.env.MONTHLY_REVIEW_PGLITE_PATH},async()=>{
  const {db,login,rpc,period}=await fixture(3,true,false);
  try{
    await rpc('as_revision_set_period_status',[period.id,'open',0]);
    const request=(await db.query("SELECT * FROM as_revision_requests WHERE employee_id='Staff A'")).rows[0];
    await login(ids.user);await rpc('as_revision_submit',[request.id,0,true]);
    const oldVersion=(await rpc('as_revision_workspace',[request.id])).versions[0];
    await db.exec('RESET ROLE');await db.exec(migration('20261026040000_as_revision_original_task_exclusion.sql'));
    await login(ids.admin);await rpc('as_revision_review',[request.id,null,'return','Allow branch removal',1]);
    await login(ids.user);let workspace=await rpc('as_revision_workspace',[request.id]);
    await rpc('as_revision_add_task',[request.id,workspace.request.draft_revision,'Excluded draft activity',ids.b,false]);
    workspace=await rpc('as_revision_workspace',[request.id]);
    const branch=workspace.items.find(item=>item.source_task_id===ids.b);const sibling=workspace.items.find(item=>item.source_task_id===ids.c);
    const added=workspace.items.find(item=>item.source_task_id===ids.added);added.action='promote';added.business.weight=40;
    const planned=workspace.items.find(item=>item.is_new);
    branch.action='exclude';sibling.business.weight=100;
    const tasksBefore=(await db.query('SELECT * FROM tasks ORDER BY id')).rows;
    const snapshots=(await db.query('SELECT * FROM assessment_task_snapshots ORDER BY id')).rows;
    let saved=await rpc('as_revision_save_draft',[request.id,workspace.request.draft_revision,JSON.stringify(workspace.items)]);
    let loaded=await rpc('as_revision_workspace',[request.id]);assert.equal(loaded.items.find(item=>item.id===branch.id).business.weight,40);
    assert.equal(loaded.items.find(item=>item.id===added.id).action,'promote');assert.equal(loaded.items.find(item=>item.id===added.id).business.weight,40);
    branch.action='original';sibling.business.weight=60;
    saved=await rpc('as_revision_save_draft',[request.id,saved.draft_revision,JSON.stringify(workspace.items)]);
    const helpers=loadTs('utils/asRevision.ts',{'./supabase':{supabase:{}}});assert.equal(helpers.validateRevision((await rpc('as_revision_workspace',[request.id])).items,request.baseline).total,100);
    branch.action='exclude';sibling.business.weight=100;
    saved=await rpc('as_revision_save_draft',[request.id,saved.draft_revision,JSON.stringify(workspace.items)]);
    await rpc('as_revision_submit',[request.id,saved.draft_revision,true]);loaded=await rpc('as_revision_workspace',[request.id]);
    assert.deepEqual(loaded.versions.find(version=>version.version_no===1),oldVersion);
    assert.equal(loaded.versions[0].items.find(item=>item.id===branch.id).action,'exclude');
    assert.equal(loaded.versions[0].items.find(item=>item.id===added.id).action,'promote');
    assert.deepEqual((await db.query('SELECT * FROM tasks ORDER BY id')).rows,tasksBefore);
    await login(ids.manager);
    for(const item of loaded.items.filter(item=>item.kind==='original'&&item.id!==branch.id))await rpc('as_revision_review',[request.id,item.id,'approve','Keep this job',2]);
    assert.equal((await rpc('as_revision_workspace',[request.id])).request.status,'submitted');
    await assert.rejects(rpc('as_revision_publish',[request.id,2]),/removal.*approved/);
    await login(ids.admin);
    assert.deepEqual((await db.query('SELECT * FROM tasks ORDER BY id')).rows.filter(task=>task.assignee==='Staff A'),tasksBefore.filter(task=>task.assignee==='Staff A'));
    await login(ids.manager);
    await assert.rejects(rpc('as_revision_review',[request.id,added.id,'approve','',2]),/official AS job or removal/);
    assert.equal((await rpc('as_revision_review',[request.id,branch.id,'approve','Approve removal of obsolete job',2])).status,'published');
    await login(ids.admin);const after=(await db.query('SELECT * FROM tasks ORDER BY id')).rows;
    for(const id of [ids.b,ids.added,ids.excluded]){
      const row=after.find(task=>task.id===id);const before=tasksBefore.find(task=>task.id===id);
      assert.ok(row.as_archived_at);assert.equal(row.weight,before.weight);assert.equal(row.progress,before.progress);assert.equal(row.status,before.status);assert.equal(row.parent_id,before.parent_id);
    }
    assert.equal(after.find(task=>task.id===ids.a).as_archived_at,null);assert.equal(Number(after.find(task=>task.id===ids.c).weight),100);
    assert.equal(after.some(task=>task.id===planned.source_task_id),false);
    assert.deepEqual((await db.query('SELECT * FROM assessment_task_snapshots ORDER BY id')).rows,snapshots);
    const history=loadTs('utils/asRevisionHistory.ts');
    const historic=history.tasksAtAssessmentPeriod(after,{self_start_at:'2000-01-01'});
    const beforeWeights=loadTs('utils/taskProgress.ts').calculateEffectiveWeightTotal(tasksBefore.filter(task=>task.assignee==='Staff A'));
    assert.equal(loadTs('utils/taskProgress.ts').calculateEffectiveWeightTotal(historic.filter(task=>task.assignee==='Staff A')),beforeWeights);
    assert.ok(historic.some(task=>task.id===ids.b&&task.as_archived_at===null));
    assert.equal((await rpc('as_revision_publish',[request.id,2])).status,'published');
    assert.equal((await db.query('SELECT count(*)::int AS n FROM as_revision_publications WHERE request_id=$1',[request.id])).rows[0].n,1);
  }finally{await db.close();}
});

test('original AS exclusion enforces ownership, returned branch scope, excluded-parent creation and complete replacement totals',{skip:!process.env.MONTHLY_REVIEW_PGLITE_PATH},async()=>{
  const {db,login,rpc,period}=await fixture(3);
  try{
    await rpc('as_revision_set_period_status',[period.id,'open',0]);
    const request=(await db.query("SELECT * FROM as_revision_requests WHERE employee_id='Staff A'")).rows[0];
    await login(ids.user);await rpc('as_revision_submit',[request.id,0,true]);await login(ids.manager);
    let workspace=await rpc('as_revision_workspace',[request.id]);const root=workspace.items.find(item=>item.source_task_id===ids.a);
    await rpc('as_revision_review',[request.id,root.id,'return','Only root text may change',1]);
    await login(ids.user);workspace=await rpc('as_revision_workspace',[request.id]);workspace.items.find(item=>item.id===root.id).action='exclude';
    await assert.rejects(rpc('as_revision_save_draft',[request.id,workspace.request.draft_revision,JSON.stringify(workspace.items)]),/whole branch/);
    assert.equal((await rpc('as_revision_workspace',[request.id])).items.find(item=>item.id===root.id).action,'original');
    await login(ids.manager);await rpc('as_revision_review',[request.id,null,'comment','Need full return',1]);
    // Resubmit unchanged so the reviewer can return the whole next version.
    await login(ids.user);workspace=await rpc('as_revision_workspace',[request.id]);
    await rpc('as_revision_submit',[request.id,workspace.request.draft_revision,true]);
    await login(ids.manager);await rpc('as_revision_review',[request.id,null,'return','Return full branch',2]);
    await login(ids.user);workspace=await rpc('as_revision_workspace',[request.id]);workspace.items.find(item=>item.id===root.id).action='exclude';
    let saved=await rpc('as_revision_save_draft',[request.id,workspace.request.draft_revision,JSON.stringify(workspace.items)]);
    await assert.rejects(rpc('as_revision_submit',[request.id,saved.draft_revision,true]),/currently 0/);
    for(const parent of [ids.a,ids.b])await assert.rejects(rpc('as_revision_add_task',[request.id,saved.draft_revision,'Invalid child',parent,false]),/included existing AS parent/);
    await login(ids.other);await assert.rejects(rpc('as_revision_save_draft',[request.id,saved.draft_revision,JSON.stringify(workspace.items)]),/Only the owner/);
    await assert.rejects(db.query("UPDATE as_revision_items SET action='exclude' WHERE id=$1",[root.id]),/permission denied/);
    await login(ids.user);await rpc('as_revision_add_task',[request.id,saved.draft_revision,'Replacement AS',null,true]);
    workspace=await rpc('as_revision_workspace',[request.id]);const replacement=workspace.items.find(item=>item.is_new);replacement.business.weight=100;
    saved=await rpc('as_revision_save_draft',[request.id,workspace.request.draft_revision,JSON.stringify(workspace.items)]);
    await rpc('as_revision_submit',[request.id,saved.draft_revision,true]);await login(ids.manager);
    await rpc('as_revision_review',[request.id,root.id,'return','Only root text may change',3]);
    await login(ids.user);let partial=await rpc('as_revision_workspace',[request.id]);partial.items.find(item=>item.id===root.id).action='original';
    await assert.rejects(rpc('as_revision_save_draft',[request.id,partial.request.draft_revision,JSON.stringify(partial.items)]),/whole branch/);
    await rpc('as_revision_submit',[request.id,partial.request.draft_revision,true]);await login(ids.manager);
    await rpc('as_revision_review',[request.id,replacement.id,'approve','New official job',4]);
    assert.equal((await rpc('as_revision_workspace',[request.id])).request.status,'submitted');
    for(const item of workspace.items.filter(item=>item.kind==='original'))await rpc('as_revision_review',[request.id,item.id,'approve','Approve old AS removal',4]);
    await login(ids.admin);const active=(await db.query("SELECT * FROM tasks WHERE assignee='Staff A' AND as_archived_at IS NULL")).rows;
    assert.equal(active.length,1);assert.equal(active[0].id,replacement.source_task_id);assert.equal(Number(active[0].weight),100);assert.equal(active[0].parent_id,null);
  }finally{await db.close();}
});

test('original AS exclusion still checks live source conflicts and rolls back the final removal approval',{skip:!process.env.MONTHLY_REVIEW_PGLITE_PATH},async()=>{
  const {db,login,rpc,period}=await fixture(3);
  try{
    await rpc('as_revision_set_period_status',[period.id,'open',0]);const request=(await db.query("SELECT * FROM as_revision_requests WHERE employee_id='Staff A'")).rows[0];
    await login(ids.user);const workspace=await rpc('as_revision_workspace',[request.id]);
    const branch=workspace.items.find(item=>item.source_task_id===ids.b);branch.action='exclude';workspace.items.find(item=>item.source_task_id===ids.c).business.weight=100;
    const saved=await rpc('as_revision_save_draft',[request.id,0,JSON.stringify(workspace.items)]);await rpc('as_revision_submit',[request.id,saved.draft_revision,true]);
    await login(ids.admin);await db.query('UPDATE tasks SET weight=41 WHERE id=$1',[ids.b]);
    for(const item of workspace.items.filter(item=>item.kind==='original'&&item.id!==branch.id))await rpc('as_revision_review',[request.id,item.id,'approve','',1]);
    await assert.rejects(rpc('as_revision_review',[request.id,branch.id,'approve','Removal',1]),/conflict/);
    const after=await rpc('as_revision_workspace',[request.id]);assert.equal(after.items.find(item=>item.id===branch.id).review_status,'pending');
    assert.equal(after.request.status,'submitted');assert.equal(after.publication,null);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM tasks WHERE as_archived_at IS NOT NULL')).rows[0].n,0);
    await db.query('UPDATE tasks SET weight=40 WHERE id=$1',[ids.b]);assert.equal((await rpc('as_revision_review',[request.id,branch.id,'approve','Removal',1])).status,'published');
  }finally{await db.close();}
});

test('revision weight ledger explains 50 + 30 + 70 = 150 without counting supporting activities',()=>{
  const {revisionWeightBreakdown,validateRevision}=loadTs('utils/asRevision.ts',{'./supabase':{supabase:{}}});
  const workspace=hierarchyWorkspace();
  const rows=revisionWeightBreakdown(workspace.items,workspace.request.baseline);
  assert.deepEqual(rows.map(row=>row.effectiveWeight),[50,30,70]);
  const validation=validateRevision(workspace.items,workspace.request.baseline);
  assert.equal(validation.before,100);assert.equal(validation.total,150);assert.match(validation.errors[0],/currently 150/);
  assert.equal(rows.flatMap(row=>row.contributions).some(row=>row.taskId==='supporting-task'),false);
  workspace.items[2].business.weight=20;
  assert.equal(validateRevision(workspace.items,workspace.request.baseline).total,100);
  assert.deepEqual(validateRevision(workspace.items,workspace.request.baseline).errors,[]);
});

test('revision ledger uses nested official child weights instead of double counting parents and rejects unsafe trees',()=>{
  const {revisionWeightBreakdown,validateRevision}=loadTs('utils/asRevision.ts',{'./supabase':{supabase:{}}});
  const workspace=hierarchyWorkspace();const [first,second,proposal,supporting]=workspace.items;
  first.business.weight=100;second.parent_task_id=first.source_task_id;second.business.weight=60;
  proposal.parent_task_id=second.source_task_id;proposal.business.weight=20;
  const rows=revisionWeightBreakdown(workspace.items);
  assert.equal(rows.length,1);assert.equal(rows[0].storedWeight,100);assert.equal(rows[0].effectiveWeight,20);
  assert.equal(rows[0].usesChildWeights,true);assert.deepEqual(rows[0].contributions.map(row=>row.taskId),[proposal.source_task_id]);
  assert.equal(validateRevision(workspace.items,[]).total,20);
  proposal.action='keep';proposal.business.weight=0;
  assert.equal(revisionWeightBreakdown(workspace.items)[0].effectiveWeight,60);
  proposal.action='exclude';assert.equal(revisionWeightBreakdown(workspace.items)[0].effectiveWeight,60);
  first.parent_task_id=second.source_task_id;assert.deepEqual(revisionWeightBreakdown(workspace.items),[]);
  first.parent_task_id=null;supporting.source_task_id=first.source_task_id;assert.deepEqual(revisionWeightBreakdown(workspace.items),[]);
});

test('database submission agrees with the visible 150% ledger and accepts 100% after an explicit weight correction',{skip:!process.env.MONTHLY_REVIEW_PGLITE_PATH},async()=>{
  const {db,login,rpc,period}=await fixture(3);
  try{
    await rpc('as_revision_set_period_status',[period.id,'open',0]);
    const request=(await db.query("SELECT * FROM as_revision_requests WHERE employee_id='Staff A'")).rows[0];
    await login(ids.user);let workspace=await rpc('as_revision_workspace',[request.id]);
    await rpc('as_revision_add_task',[request.id,workspace.request.draft_revision,'New root AS',null,true]);
    workspace=await rpc('as_revision_workspace',[request.id]);
    for(const item of workspace.items){
      if(item.source_task_id===ids.b)item.business.weight=50;
      if(item.source_task_id===ids.c)item.business.weight=30;
      if(item.is_new)item.business.weight=70;
      if(item.kind==='user_added'&&!item.is_new){item.action='keep';item.business.weight=0;}
    }
    const helpers=loadTs('utils/asRevision.ts',{'./supabase':{supabase:{}}});
    // The fixture has a 100% AS container above the 50/30 jobs; do not add it again.
    assert.equal(helpers.validateRevision(workspace.items,workspace.request.baseline).total,150);
    assert.equal(helpers.revisionWeightBreakdown(workspace.items).reduce((sum,row)=>sum+row.effectiveWeight,0),150);
    let saved=await rpc('as_revision_save_draft',[request.id,workspace.request.draft_revision,JSON.stringify(workspace.items)]);
    await assert.rejects(rpc('as_revision_submit',[request.id,saved.draft_revision,true]),/150/);
    workspace.items.find(item=>item.is_new).business.weight=20;
    saved=await rpc('as_revision_save_draft',[request.id,saved.draft_revision,JSON.stringify(workspace.items)]);
    assert.equal((await rpc('as_revision_submit',[request.id,saved.draft_revision,true])).status,'submitted');
    assert.equal((await db.query('SELECT count(*)::int AS count FROM tasks WHERE name=$1',['New root AS'])).rows[0].count,0);
  }finally{await db.close();}
});

test('revision UI nests activities under their AS parent and shows new official roots in the same workspace with live totals',async()=>{
  const workspace=hierarchyWorkspace();const harness=uiHarness(workspace,{id:ids.user,role:'user'},{});
  let tree=await settleUi(harness);
  const parent=uiElements(tree).find(node=>node.props?.['data-revision-task']==='first-task');
  const supporting=uiElements(parent).find(node=>node.props?.['data-revision-task']==='supporting-task');assert.ok(supporting);
  assert.equal(uiElements(parent).some(node=>node.props?.['data-revision-task']==='second-task'),false);
  assert.equal(uiElements(parent).some(node=>node.props?.['data-revision-task']==='proposal-task'),false);
  assert.match(uiText(supporting),/Official 0%/);
  assert.equal(uiElements(supporting).some(node=>node.type==='input'&&node.props.type==='number'),true); // Frequency/time fields remain editable.
  assert.equal(uiElements(supporting).some(node=>node.type==='label'&&uiText(node).startsWith('Official weight')),false);
  assert.match(uiText(tree),/เกินเป้าหมาย 50%/);assert.match(uiText(tree),/150%/);
  assert.equal(uiText(tree).includes('New tasks in this revision'),false);assert.equal(uiText(tree).includes('Select Existing User-added Tasks'),false);
  const proposal=uiElements(tree).find(node=>node.props?.['data-revision-task']==='proposal-task');assert.ok(proposal);
  const weight=uiElements(proposal).find(node=>node.type==='input'&&node.props.value===70);weight.props.onChange({target:{value:'20'}});tree=harness.render();
  assert.match(uiText(tree),/ครบตามเป้าหมาย/);assert.equal(uiText(tree).includes('currently 150'),false);
  assert.equal(uiElements(parent).find(node=>node.props?.['aria-label']==='เพิ่มงานย่อยใต้: 1.1 Original AS').props.disabled,false);
  assert.equal(uiElements(tree).find(node=>node.props?.['aria-label']==='เพิ่มงานย่อยใต้: 1.1 Original AS').props.disabled,true);
  await uiButton(tree,'Save Draft').props.onClick();
  const changes=harness.calls.find(call=>call.name==='as_revision_save_draft').args.item_changes;
  assert.equal(changes.find(item=>item.id==='proposal').business.weight,20);assert.equal(changes.find(item=>item.id==='supporting').business.weight,0);
});

test('parent add action defaults to a supporting task under the clicked original and keeps return scopes locked',async()=>{
  const workspace=hierarchyWorkspace();const harness=uiHarness(workspace,{id:ids.user,role:'user'},{});
  let tree=await settleUi(harness);uiElements(tree).find(node=>node.props?.['aria-label']==='เพิ่มงานย่อยใต้: 1.1 Original AS').props.onClick();tree=harness.render();
  const form=uiElements(tree).find(node=>node.type==='form');assert.match(uiText(form),/เพิ่มงานใต้: 1.1 Original AS/);
  const parent=uiElements(form).find(node=>node.type==='select'&&node.props.value==='first-task');assert.ok(parent);
  const type=uiElements(form).find(node=>node.type==='select'&&node.props.value==='supporting');assert.ok(type);
  const name=uiElements(form).find(node=>node.type==='input');name.props.onChange({target:{value:'New supporting activity'}});tree=harness.render();
  uiElements(tree).find(node=>node.type==='form').props.onSubmit({preventDefault(){}});tree=await settleUi(harness);
  const call=harness.calls.find(call=>call.name==='as_revision_add_task');assert.equal(call.args.target_parent_id,'first-task');assert.equal(call.args.make_official,false);
  const parentJob=uiElements(tree).find(node=>node.props?.['data-revision-task']==='first-task');assert.match(uiText(parentJob),/New supporting activity/);
  const returned=hierarchyWorkspace();returned.request.status='returned';returned.items[0].review_status='returned';
  const locked=uiHarness(returned,{id:ids.user,role:'user'},{});tree=await settleUi(locked);
  assert.equal(uiElements(tree).find(node=>node.props?.['aria-label']==='เพิ่มงานย่อยใต้: 1.1 Original AS'),undefined);assert.equal(uiButton(tree,'Add new task').props.disabled,true);
  const compare=uiHarness(hierarchyWorkspace(),{id:ids.user,role:'user'},{compare:true});tree=await settleUi(compare);
  assert.match(uiText(tree),/เกินเป้าหมาย 50%/);assert.equal(uiButton(tree,'Submit for Approval').props.disabled,true);
});

test('original AS exclusion UI confirms branch removal, preserves saved child choices and restores them after Save Draft',async()=>{
  const previous=global.confirm;const prompts=[];
  try{
    const workspace=hierarchyWorkspace();const harness=uiHarness(workspace,{id:ids.user,role:'user'},{});let tree=await settleUi(harness);
    const job=()=>uiElements(tree).find(node=>node.props?.['data-revision-task']==='first-task');
    const checkbox=()=>uiElements(job()).find(node=>node.type==='label'&&uiText(node)===' รวมงานนี้ใน AS รอบใหม่').props.children[0];
    assert.equal(checkbox().props.checked,true);
    global.confirm=()=>false;checkbox().props.onChange({target:{checked:false}});tree=harness.render();assert.equal(checkbox().props.checked,true);
    global.confirm=message=>{prompts.push(message);return true;};checkbox().props.onChange({target:{checked:false}});tree=harness.render();
    assert.match(prompts[0],/งานย่อย 1 รายการ/);assert.equal(checkbox().props.checked,false);assert.equal(checkbox().props.disabled,false);
    assert.match(uiText(job()),/เสนอเอาออก/);assert.match(uiText(tree),/ครบตามเป้าหมาย/);
    const support=uiElements(job()).find(node=>node.props?.['data-revision-task']==='supporting-task');
    const supportCheckbox=uiElements(support).find(node=>node.type==='input'&&node.props.type==='checkbox');assert.equal(supportCheckbox.props.checked,false);assert.equal(supportCheckbox.props.disabled,true);
    assert.equal(uiElements(job()).some(node=>node.props?.['aria-label']==='เพิ่มงานย่อยใต้: 1.1 Original AS'),false);
    await uiButton(tree,'Save Draft').props.onClick();tree=harness.render();
    const saved=harness.calls.find(call=>call.name==='as_revision_save_draft').args.item_changes;
    assert.equal(saved.find(item=>item.id==='first').action,'exclude');assert.equal(saved.find(item=>item.id==='first').business.weight,50);
    assert.equal(saved.find(item=>item.id==='supporting').action,'keep');
    checkbox().props.onChange({target:{checked:true}});tree=harness.render();
    assert.equal(checkbox().props.checked,true);assert.match(uiText(tree),/เกินเป้าหมาย 50%/);
    const restored=uiElements(job()).find(node=>node.props?.['data-revision-task']==='supporting-task');
    assert.equal(uiElements(restored).find(node=>node.type==='input'&&node.props.type==='checkbox').props.checked,true);
    const returned=hierarchyWorkspace();returned.request.status='returned';returned.items[0].review_status='returned';
    const locked=uiHarness(returned,{id:ids.user,role:'user'},{});const lockedTree=await settleUi(locked);
    const parent=uiElements(lockedTree).find(node=>node.props?.['data-revision-task']==='first-task');
    assert.equal(uiElements(parent).find(node=>node.type==='input'&&node.props.type==='checkbox').props.disabled,true);
  }finally{global.confirm=previous;}
});

test('original AS exclusion comparison and review show removal approvals, inherited exclusions and retained weights',async()=>{
  const previous=global.confirm;const prompts=[];
  try{
    const workspace=hierarchyWorkspace();workspace.items[0].action='exclude';
    workspace.items.push({id:'child-as',source_task_id:'child-as-task',kind:'original',parent_task_id:'first-task',action:'original',business:{name:'Nested AS',weight:50},original_business:{name:'Nested AS',weight:50},review_status:'pending'});
    const comparison=uiHarness(workspace,{id:ids.user,role:'user'},{compare:true});let tree=await settleUi(comparison);
    assert.match(uiText(tree),/เสนอเอางาน AS ออก/);assert.match(uiText(tree),/0% counted \/ retained weight 50%/);
    assert.match(uiText(tree),/พร้อม parent: 1.1 Original AS/);assert.match(uiText(tree),/ครบตามเป้าหมาย/);
    workspace.can_edit=false;workspace.can_review=true;workspace.request.status='submitted';workspace.request.current_version=1;
    const reviewer=uiHarness(workspace,{id:ids.manager,role:'manager'},{review:true});tree=await settleUi(reviewer);
    const buttons=uiElements(tree).filter(node=>node.type==='button'&&uiText(node)==='Approve AS removal');assert.equal(buttons.length,2);
    global.confirm=message=>{prompts.push(message);return true;};await buttons[0].props.onClick();
    assert.match(prompts[0],/Approve removal/);assert.equal(reviewer.calls.find(call=>call.name==='as_revision_review').args.target_item_id,'first');
    assert.equal(uiButton(tree,'Save Draft'),undefined);
  }finally{global.confirm=previous;}
});

test('pre-creation history excludes new tasks from all earlier assessment windows across later publications',()=>{
  const {tasksAtAssessmentPeriod}=loadTs('utils/asRevisionHistory.ts');
  const task={id:'new',name:'Latest AS',weight:30,task_source:'as_original',as_business_history:[
    {replaced_at:'2027-01-01',configuration:null},
    {replaced_at:'2028-01-01',configuration:{business:{name:'First AS',weight:20},as_archived_at:null}},
  ]};
  assert.deepEqual(tasksAtAssessmentPeriod([task],{self_start_at:'2026-01-01'}),[]);
  assert.equal(tasksAtAssessmentPeriod([task],{self_start_at:'2027-06-01'})[0].weight,20);
  assert.equal(tasksAtAssessmentPeriod([task],{self_start_at:'2028-06-01'})[0].weight,30);
  assert.deepEqual(tasksAtAssessmentPeriod([task],{}),[]);
});

test('period UI confirms deletion, disables history rows, redirects detail and preserves rows on server errors',async()=>{
  const previousConfirm=global.confirm;const prompts=[];
  const empty={id:'empty',title:'Unused annual period',year:2026,cycle:'Annual',starts_at:'2026-01-01',ends_at:'2026-12-31',status:'draft',revision:2,eligible_team_ids:[],eligible_profile_ids:[]};
  const captured={...empty,id:'captured',title:'Historical period',status:'closed'};
  const options={component:'RevisionPeriods',params:{period_id:empty.id},rows:{as_revision_periods:[empty,captured],as_revision_requests:[{id:'request',period_id:captured.id}],profiles:[],teams:[],as_revision_items:[]}};
  const admin={id:ids.admin,role:'admin',display_name:'Admin'};
  try{
    const harness=uiHarness({},admin,{},options);let tree=await settleUi(harness);
    const buttons=uiElements(tree).filter(node=>node.type==='button'&&uiText(node)==='Delete period');
    assert.equal(buttons.length,3);assert.equal(buttons[0].props.disabled,false);assert.equal(buttons[2].props.disabled,true);
    global.confirm=()=>false;await buttons[0].props.onClick();assert.equal(harness.calls.length,0);
    global.confirm=message=>{prompts.push(message);return true;};await buttons[0].props.onClick();tree=harness.render();
    assert.match(prompts[0],/Unused annual period/);assert.match(prompts[0],/cannot be undone/);
    assert.deepEqual(harness.calls[0],{name:'as_revision_delete_period',args:{target_period_id:empty.id,expected_revision:2}});
    assert.deepEqual(harness.routes,['/admin/as-revisions']);assert.equal(uiText(tree).includes(empty.title),false);assert.match(uiText(tree),/period deleted/);
    const failed=uiHarness({},admin,{},{...options,deleteError:'Period changed; reload before deleting'});tree=await settleUi(failed);
    await uiButton(tree,'Delete period').props.onClick();tree=failed.render();assert.match(uiText(tree),/Period changed/);assert.ok(uiText(tree).includes(empty.title));assert.deepEqual(failed.routes,[]);
    for(const role of ['manager','user']){const denied=uiHarness({},{id:ids.user,role},{},options);tree=await settleUi(denied);assert.equal(uiButton(tree,'Delete period'),undefined);}
  }finally{global.confirm=previousConfirm;}
});

function deletionUiOptions(overrides={}){
  const period={id:'test-period',title:'AS test period',status:'closed',revision:2,year:2026,cycle:'Annual',starts_at:'2026-01-01',ends_at:'2026-12-31',eligible_team_ids:[],eligible_profile_ids:[]};
  return {component:'RevisionPeriods',params:{period_id:period.id},rows:{as_revision_periods:[period],as_revision_requests:[{id:'employee-request',period_id:period.id,employee_id:'Staff A',status:'submitted',current_version:1}],as_revision_items:[{id:'item',request_id:'employee-request',action:'original',review_status:'pending'}],profiles:[],teams:[]},deletionPreview:{period_id:period.id,title:period.title,revision:2,contents_token:'server-preview-token',can_delete:true,blocked_reason:null,counts:{employees:1,drafts:0,submitted:1,returned:0,approved:0,cancelled:0,published:0,items:1,versions:1,reviews:1,publications:0}},...overrides};
}

test('admin cleanup UI previews scoped counts, requires the exact title, supports cancellation and redirects only on success',async()=>{
  const options=deletionUiOptions();const harness=uiHarness({},{id:ids.admin,role:'admin'},{},options);
  let tree=await settleUi(harness);assert.ok(uiButton(tree,'ตรวจสอบข้อมูลก่อนลบ'));assert.equal(uiButton(tree,'ลบ Period และข้อมูล Revision ทั้งหมด'),undefined);
  await uiButton(tree,'ตรวจสอบข้อมูลก่อนลบ').props.onClick();tree=harness.render();
  const form=uiElements(tree).find(node=>node.type==='form'&&uiText(node).includes('พิมพ์ชื่อ Period เพื่อยืนยัน'));
  assert.ok(form);assert.match(uiText(form),/พนักงาน \/ Revision1/);assert.match(uiText(tree),/งานจริงและข้อมูลประเมินจะไม่ถูกลบ/);
  assert.equal(uiButton(tree,'ลบ Period และข้อมูล Revision ทั้งหมด').props.disabled,true);
  const input=uiElements(form).find(node=>node.type==='input');assert.equal(input.props.value,'');
  input.props.onChange({target:{value:'Wrong name'}});tree=harness.render();
  assert.equal(uiButton(tree,'ลบ Period และข้อมูล Revision ทั้งหมด').props.disabled,true);
  await uiElements(tree).find(node=>node.type==='form'&&uiText(node).includes('พิมพ์ชื่อ Period เพื่อยืนยัน')).props.onSubmit({preventDefault(){}});
  assert.equal(harness.calls.some(call=>call.name==='as_revision_delete_unpublished_period'),false);
  uiButton(tree,'Cancel deletion').props.onClick();tree=harness.render();assert.equal(uiButton(tree,'ลบ Period และข้อมูล Revision ทั้งหมด'),undefined);
  await uiButton(tree,'ตรวจสอบข้อมูลก่อนลบ').props.onClick();tree=harness.render();
  let confirmation=uiElements(tree).find(node=>node.type==='label'&&uiText(node).startsWith('พิมพ์ชื่อ Period เพื่อยืนยัน'));
  uiElements(confirmation).find(node=>node.type==='input').props.onChange({target:{value:options.deletionPreview.title}});tree=harness.render();
  assert.equal(uiButton(tree,'ลบ Period และข้อมูล Revision ทั้งหมด').props.disabled,false);
  await uiElements(tree).find(node=>node.type==='form'&&uiText(node).includes('พิมพ์ชื่อ Period เพื่อยืนยัน')).props.onSubmit({preventDefault(){}});tree=harness.render();
  const call=harness.calls.find(call=>call.name==='as_revision_delete_unpublished_period');
  assert.deepEqual(call.args,{target_period_id:'test-period',expected_revision:2,confirmation_title:'AS test period',expected_contents_token:'server-preview-token'});
  assert.deepEqual(harness.routes,['/admin/as-revisions']);assert.match(uiText(tree),/period deleted/);
  assert.equal(uiText(tree).includes('Staff A'),false);assert.equal(uiText(tree).includes('AS test period'),false);
});

test('cleanup UI blocks unauthorized/open/published scopes and forces a new preview after server errors',async()=>{
  for(const role of ['user','manager']){
    const harness=uiHarness({},{id:ids.user,role},{},deletionUiOptions());const tree=await settleUi(harness);
    assert.equal(uiButton(tree,'ตรวจสอบข้อมูลก่อนลบ'),undefined);
  }
  for(const status of ['open','draft']){
    const options=deletionUiOptions();options.rows.as_revision_periods[0].status=status;
    const harness=uiHarness({},{id:ids.admin,role:'admin'},{},options);let tree=await settleUi(harness);
    assert.equal(uiButton(tree,'ตรวจสอบข้อมูลก่อนลบ').props.disabled,true);
    await uiButton(tree,'ตรวจสอบข้อมูลก่อนลบ').props.onClick();assert.equal(harness.calls.length,0);
  }
  const published=deletionUiOptions();published.rows.as_revision_requests[0].status='published';
  const publishedHarness=uiHarness({},{id:ids.admin,role:'admin'},{},published);let tree=await settleUi(publishedHarness);
  assert.equal(uiButton(tree,'ตรวจสอบข้อมูลก่อนลบ').props.disabled,true);assert.match(uiText(tree),/Published แล้ว/);
  const blocked=deletionUiOptions();blocked.deletionPreview.can_delete=false;blocked.deletionPreview.blocked_reason='Cannot delete a period with publication history';
  const blockedHarness=uiHarness({},{id:ids.admin,role:'admin'},{},blocked);tree=await settleUi(blockedHarness);
  await uiButton(tree,'ตรวจสอบข้อมูลก่อนลบ').props.onClick();tree=blockedHarness.render();
  assert.match(uiText(tree),/publication history/);assert.equal(uiButton(tree,'ลบ Period และข้อมูล Revision ทั้งหมด').props.disabled,true);
  const options=deletionUiOptions({cleanupError:'Revision data changed; preview again before deleting'});
  const failed=uiHarness({},{id:ids.admin,role:'admin'},{},options);tree=await settleUi(failed);
  await uiButton(tree,'ตรวจสอบข้อมูลก่อนลบ').props.onClick();tree=failed.render();
  const form=uiElements(tree).find(node=>node.type==='form'&&uiText(node).includes('พิมพ์ชื่อ Period เพื่อยืนยัน'));
  uiElements(form).find(node=>node.type==='input').props.onChange({target:{value:options.deletionPreview.title}});tree=failed.render();
  await uiElements(tree).find(node=>node.type==='form'&&uiText(node).includes('พิมพ์ชื่อ Period เพื่อยืนยัน')).props.onSubmit({preventDefault(){}});tree=failed.render();
  assert.match(uiText(tree),/Revision data changed/);assert.ok(uiText(tree).includes('AS test period'));
  const requestTable=uiElements(tree).find(node=>node.type?.name==='RequestTable');assert.equal(requestTable.props.requests[0].employee_id,'Staff A');assert.deepEqual(failed.routes,[]);
  assert.equal(uiButton(tree,'ลบ Period และข้อมูล Revision ทั้งหมด'),undefined);
  assert.ok(uiButton(tree,'ตรวจสอบข้อมูลก่อนลบ'));
});

test('employee UI saves drafts only through RPC and gates submission on comparison confirmation',async()=>{
  const task={id:'task',name:'AS job',weight:100,progress:20,task_source:'as_original'};
  const item={id:'item',request_id:'request',source_task_id:task.id,parent_task_id:null,kind:'original',action:'original',original_business:{name:task.name,weight:100},business:{name:task.name,weight:100},review_status:'pending'};
  const workspace={request:{id:'request',employee_id:'Staff A',baseline:[task],status:'draft',draft_revision:0,current_version:0},period:{title:'Annual AS',weight_target:100},items:[item],versions:[],reviews:[],publication:null,can_edit:true,can_review:false};
  const harness=uiHarness(workspace,{id:ids.user,display_name:'Staff A',role:'user'},{});let tree=await settleUi(harness);
  const name=uiElements(tree).find(node=>node.type==='input'&&node.props.value===task.name);assert.ok(name);assert.equal(name.props.disabled,false);
  name.props.onChange({target:{value:'Revised AS job'}});tree=harness.render();assert.equal(uiButton(tree,'Save Draft').props.disabled,false);
  await uiButton(tree,'Save Draft').props.onClick();tree=harness.render();assert.match(uiText(tree),/Draft saved/);
  const saved=harness.calls.find(call=>call.name==='as_revision_save_draft');assert.equal(saved.args.item_changes[0].business.name,'Revised AS job');
  assert.equal(saved.args.expected_draft_revision,0);
  const compare=uiHarness(workspace,{id:ids.user,display_name:'Staff A',role:'user'},{compare:true});tree=await settleUi(compare);
  assert.equal(uiButton(tree,'Submit for Approval').props.disabled,true);
  uiElements(tree).find(node=>node.type==='input'&&node.props.type==='checkbox').props.onChange({target:{checked:true}});tree=compare.render();
  assert.equal(uiButton(tree,'Submit for Approval').props.disabled,false);await uiButton(tree,'Submit for Approval').props.onClick();
  assert.equal(compare.calls.find(call=>call.name==='as_revision_submit').args.comparison_confirmed,true);
  assert.equal(uiButton(tree,'Approve AS job'),undefined);
});

test('review UI uses version-checked job approvals and requires a return reason',async()=>{
  const previousConfirm=global.confirm;global.confirm=()=>true;
  try{
    const task={id:'task',name:'AS job',weight:100,task_source:'as_original'};
    const item={id:'item',source_task_id:'task',parent_task_id:null,kind:'original',action:'original',business:{name:task.name,weight:100},original_business:{name:task.name,weight:100},review_status:'pending'};
    const workspace={request:{id:'request',employee_id:'Staff A',baseline:[task],status:'submitted',draft_revision:1,current_version:2},period:{title:'Annual AS',weight_target:100},items:[item],versions:[],reviews:[],publication:null,can_edit:false,can_review:true};
    const harness=uiHarness(workspace,{id:ids.manager,role:'manager',display_name:'Manager'},{review:true});let tree=await settleUi(harness);
    assert.equal(uiButton(tree,'Return for Revision').props.disabled,true);assert.equal(uiButton(tree,'Save Draft'),undefined);
    await uiButton(tree,'Approve AS job').props.onClick();
    const approved=harness.calls.find(call=>call.name==='as_revision_review');assert.equal(approved.args.target_item_id,'item');assert.equal(approved.args.expected_version,2);
    tree=harness.render();uiElements(tree).find(node=>node.type==='textarea').props.onChange({target:{value:'Please clarify workload'}});tree=harness.render();
    assert.equal(uiButton(tree,'Return for Revision').props.disabled,false);await uiButton(tree,'Return for Revision').props.onClick();
    assert.equal(harness.calls.at(-2).args.review_comment,'Please clarify workload');
  }finally{global.confirm=previousConfirm;}
});

test('comparison covers every supported field, archived tracking is excluded and assessment configuration is period-stable',()=>{
  const helpers=loadTs('utils/asRevision.ts',{'./supabase':{supabase:{}}});
  const business={name:'Old AS',weight:100};
  const item={id:'i',source_task_id:'root',parent_task_id:null,kind:'original',action:'original',original_business:business,business:{...business}};
  for(const [field] of helpers.REVISION_FIELDS){const changed={...item,business:{...business,[field]:'changed'}};assert.ok(helpers.revisionDifferences(changed).some(([key])=>key===field),field);}
  const history=loadTs('utils/asRevisionHistory.ts');const tracking=loadTs('utils/userAddedProgress.ts');
  const oldTask={id:'added',name:'Supporting activity',parent_id:'root',weight:0,task_source:'user_added',counts_toward_assessment:false,include_in_ai_summary:true,as_archived_at:null,progress:70,user_added_weight:65,user_added_weight_is_manual:true};
  const promoted={...oldTask,name:'New AS',task_source:'as_original',weight:100,counts_toward_assessment:true,
    as_business_history:[{replaced_at:'2027-01-01T00:00:00Z',configuration:{business:{name:oldTask.name,weight:0},task_source:'user_added',counts_toward_assessment:false,as_archived_at:null}}]};
  const archived={...oldTask,id:'archived',as_archived_at:'2027-01-01T00:00:00Z',as_business_history:[{replaced_at:'2027-01-01T00:00:00Z',configuration:{business:{name:oldTask.name,weight:0},task_source:'user_added',counts_toward_assessment:false,as_archived_at:null}}]};
  const old=history.tasksAtAssessmentPeriod([promoted,archived],{self_start_at:'2026-01-01'});
  assert.equal(old.length,2);assert.equal(old[0].task_source,'user_added');assert.equal(old[0].weight,0);
  assert.equal(old[0].progress,70);assert.equal(old[0].user_added_weight_is_manual,true);
  assert.equal(loadTs('utils/evaluationTasks.ts').getEvaluableTasks(old).length,0);
  const current=history.tasksAtAssessmentPeriod([promoted,archived],{self_start_at:'2027-02-01'});
  assert.equal(current.length,1);assert.equal(current[0].weight,100);
  assert.equal(tracking.getTrackingTaskContext([promoted,archived]).length,1);
  assert.equal(tracking.calculateAutoUserAddedWeights([oldTask,archived]).weights.archived,undefined);
});

test('milestone 3: serialized duplicate approvals publish exactly once; live membership drift blocks publication',{skip:!process.env.MONTHLY_REVIEW_PGLITE_PATH},async()=>{
  const {db,login,rpc,period}=await fixture(3);
  try{
    await rpc('as_revision_set_period_status',[period.id,'open',0]);const request=(await db.query("SELECT * FROM as_revision_requests WHERE employee_id='Staff A'")).rows[0];
    await login(ids.user);await rpc('as_revision_submit',[request.id,0,true]);
    await login(ids.admin);
    const inserted=(await db.query("INSERT INTO tasks(name,assignee,team_id,parent_id,task_source,weight,counts_toward_assessment,include_in_ai_summary) VALUES('New activity','Staff A',$1,$2,'user_added',0,false,true) RETURNING id",[ids.team,ids.b])).rows[0];
    await login(ids.manager);const workspace=await rpc('as_revision_workspace',[request.id]);const required=workspace.items.filter(item=>item.action==='original');
    for(const item of required.slice(0,-1))await rpc('as_revision_review',[request.id,item.id,'approve','',1]);
    await assert.rejects(rpc('as_revision_review',[request.id,required.at(-1).id,'approve','',1]),/membership changed/);
    await login(ids.admin);await db.query('DELETE FROM tasks WHERE id=$1',[inserted.id]);
    await login(ids.manager);
    const results=await Promise.all([rpc('as_revision_review',[request.id,required.at(-1).id,'approve','First',1]),rpc('as_revision_review',[request.id,required.at(-1).id,'approve','Retry',1])]);
    assert.ok(results.every(result=>result.status==='published'));
    const after=await rpc('as_revision_workspace',[request.id]);assert.equal(after.reviews.filter(event=>event.action==='publish').length,1);
    assert.equal(after.reviews.filter(event=>event.action==='approve'&&event.item_id===required.at(-1).id).length,1);
  }finally{await db.close();}
});

test('milestone 3: per-employee atomic publication, promotion, archive, idempotence and scoped security',{skip:!process.env.MONTHLY_REVIEW_PGLITE_PATH},async()=>{
  const {db,login,rpc,period}=await fixture(3);
  try {
    await rpc('as_revision_set_period_status',[period.id,'open',0]);
    const requests=(await db.query('SELECT * FROM as_revision_requests')).rows;
    const request=requests.find(row=>row.employee_id==='Staff A');
    const original=(await db.query('SELECT * FROM tasks ORDER BY id')).rows;
    await login(ids.user);let workspace=await rpc('as_revision_workspace',[request.id]);
    const items=workspace.items.map(item=>({...item,business:{...item.business}}));
    const added=items.find(item=>item.source_task_id===ids.added);added.action='promote';added.business.weight=40;
    added.business.name='Approved promotion';
    await rpc('as_revision_save_draft',[request.id,0,JSON.stringify(items)]);
    await rpc('as_revision_submit',[request.id,1,true]);
    await assert.rejects(rpc('as_revision_review',[request.id,items[0].id,'approve','',1]),/non-self reviewer/);
    await assert.rejects(rpc('as_revision_publish_internal',[request.id,1]),/permission denied/);
    await assert.rejects(db.query('INSERT INTO as_revision_write_guards VALUES($1,txid_current(),auth.uid())',[request.id]),/permission denied/);
    await login(ids.manager);
    await assert.rejects(rpc('as_revision_review',[requests.find(row=>row.employee_id==='Staff B').id,null,'comment','Forbidden',0]),/non-self reviewer/);
    await assert.rejects(rpc('as_revision_review',[request.id,null,'return','',1]),/return reason/);
    await assert.rejects(rpc('as_revision_review',[request.id,items[0].id,'approve','',null]),/version changed/);
    const required=items.filter(item=>['original','promote'].includes(item.action));
    for(const item of required.slice(0,-1))await rpc('as_revision_review',[request.id,item.id,'approve','Checked',1]);
    await login(ids.admin);assert.deepEqual((await db.query('SELECT * FROM tasks ORDER BY id')).rows,original);
    await login(ids.manager);
    const published=await rpc('as_revision_review',[request.id,required.at(-1).id,'approve','Final approval',1]);
    assert.equal(published.status,'published');
    await login(ids.admin);
    const after=(await db.query('SELECT * FROM tasks ORDER BY id')).rows;
    assert.equal(after.length,original.length);
    const promoted=after.find(row=>row.id===ids.added);assert.equal(promoted.task_source,'as_original');assert.equal(promoted.weight,'40');assert.equal(promoted.counts_toward_assessment,true);
    assert.equal(promoted.progress,'100');assert.equal(promoted.user_added_weight,'50');
    const archived=after.find(row=>row.id===ids.excluded);assert.ok(archived.as_archived_at);assert.equal(archived.name,'Historical added');
    assert.equal((await db.query('SELECT status FROM as_revision_requests WHERE employee_id=$1',['Staff B'])).rows[0].status,'draft');
    assert.deepEqual((await db.query('SELECT task_id,weight FROM assessment_task_snapshots ORDER BY task_id')).rows,[{task_id:ids.b,weight:'40'},{task_id:ids.c,weight:'60'}]);
    for(const row of after)assert.equal(row.progress,original.find(task=>task.id===row.id).progress);
    await db.exec('RESET ROLE');assert.equal(Number((await db.query('SELECT count(*) AS count FROM as_revision_write_guards')).rows[0].count),0);
    await db.exec(fs.readFileSync('docs/as-revision-postcheck.sql','utf8'));await login(ids.admin);
    await rpc('as_revision_publish',[request.id,1]);await rpc('as_revision_review',[request.id,required[0].id,'approve','Retry',1]);
    assert.equal((await db.query('SELECT * FROM as_revision_publications')).rows.length,1);
    await assert.rejects(db.query("UPDATE tasks SET as_archived_at=NULL WHERE id=$1",[ids.excluded]),/Archived tasks/);
    await assert.rejects(db.query("UPDATE tasks SET as_business_history='[]' WHERE id=$1",[ids.a]),/lifecycle metadata/);
  }finally{await db.close();}
});

test('milestone 3: scoped returns, immutable resubmissions, closed-window extension and conflict rollback',{skip:!process.env.MONTHLY_REVIEW_PGLITE_PATH},async()=>{
  const {db,login,rpc,period}=await fixture(3);
  try {
    const opened=await rpc('as_revision_set_period_status',[period.id,'open',0]);
    const request=(await db.query("SELECT * FROM as_revision_requests WHERE employee_id='Staff A'")).rows[0];
    await login(ids.user);let workspace=await rpc('as_revision_workspace',[request.id]);
    const kept=workspace.items.find(item=>item.source_task_id===ids.added);kept.action='keep';
    await rpc('as_revision_save_draft',[request.id,0,JSON.stringify(workspace.items)]);await rpc('as_revision_submit',[request.id,1,true]);
    await login(ids.admin);await rpc('as_revision_set_period_status',[period.id,'closed',opened.revision]);
    await login(ids.manager);
    const b=workspace.items.find(item=>item.source_task_id===ids.b);
    await rpc('as_revision_review',[request.id,b.id,'approve','',1]);
    await rpc('as_revision_review',[request.id,b.id,'return','Please revise output',1]);
    await login(ids.user);workspace=await rpc('as_revision_workspace',[request.id]);assert.equal(workspace.can_edit,false);
    await assert.rejects(rpc('as_revision_save_draft',[request.id,workspace.request.draft_revision,JSON.stringify(workspace.items)]),/Only the owner/);
    await login(ids.admin);await rpc('as_revision_admin_exception',[request.id,'extend','Allow requested correction','2099-01-01T00:00:00Z']);
    await login(ids.user);workspace=await rpc('as_revision_workspace',[request.id]);assert.equal(workspace.can_edit,true);
    const illegal=structuredClone(workspace.items);illegal.find(item=>item.source_task_id===ids.c).business.name='Not returned';
    await assert.rejects(rpc('as_revision_save_draft',[request.id,workspace.request.draft_revision,JSON.stringify(illegal)]),/Only returned/);
    workspace.items.find(item=>item.id===b.id).business.output='Corrected deliverable';
    const saved=await rpc('as_revision_save_draft',[request.id,workspace.request.draft_revision,JSON.stringify(workspace.items)]);
    await rpc('as_revision_submit',[request.id,saved.draft_revision,true]);
    workspace=await rpc('as_revision_workspace',[request.id]);assert.equal(workspace.versions.length,2);assert.ok(workspace.items.every(item=>item.review_status==='pending'));
    assert.notEqual(workspace.versions.find(row=>row.version_no===1).items.find(item=>item.id===b.id).business.output,'Corrected deliverable');
    await login(ids.admin);await db.query('UPDATE tasks SET name=$1 WHERE id=$2',['Concurrent live edit',ids.c]);
    await login(ids.manager);const required=workspace.items.filter(item=>item.action==='original');
    for(const item of required.slice(0,-1))await rpc('as_revision_review',[request.id,item.id,'approve','',2]);
    await assert.rejects(rpc('as_revision_review',[request.id,required.at(-1).id,'approve','',2]),/business\/ownership\/hierarchy conflict/);
    workspace=await rpc('as_revision_workspace',[request.id]);assert.equal(workspace.request.status,'submitted');assert.equal(workspace.publication,null);
    assert.equal(workspace.items.find(item=>item.id===required.at(-1).id).review_status,'pending');
    await login(ids.admin);await db.query('UPDATE tasks SET name=$1 WHERE id=$2',['AS C',ids.c]);
    await login(ids.manager);await rpc('as_revision_review',[request.id,required.at(-1).id,'approve','',2]);
    await login(ids.admin);assert.equal(Number((await db.query('SELECT user_added_weight FROM tasks WHERE id=$1',[ids.added])).rows[0].user_added_weight),100);
    const rebalanced=(await db.query('SELECT * FROM rebalance_user_added_task_weights($1,false)',[ids.b])).rows;assert.equal(rebalanced.length,1);
  }finally{await db.close();}
});
