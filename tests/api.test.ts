import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { apiResponse } from "../src/api.js";
import { WorktrailDatabase } from "../src/db/database.js";
import { insertSyntheticThread, syntheticId } from "./helpers/synthetic-corpus.js";
import { assignThread, createWorkstream, addWorkstreamAlias } from "../src/workstreams.js";

function fixture(run:(db:WorktrailDatabase,path:string)=>void){const dir=mkdtempSync(join(tmpdir(),"worktrail-api-"));const path=join(dir,"test.db");const db=new WorktrailDatabase(path);try{insertSyntheticThread(db,{externalId:syntheticId(1),title:"Widget repair",cwd:"/repo",updatedAt:"2026-01-01T00:00:00Z",evidence:["Repaired the widget safely"],files:["/repo/src/widget.ts"]});run(db,path)}finally{db.close();rmSync(dir,{recursive:true,force:true})}}
test("state API is stable and evidence is opt-in",()=>fixture((db,path)=>{const hidden=apiResponse(db,path,new URL("http://x/api/state?q=widget"));assert.equal(hidden.status,200);const body=hidden.body as any;assert.equal(body.version,1);assert.equal(body.best.workstream.name,"Widget repair");assert.deepEqual(body.best.latestEvidence,[]);const shown=apiResponse(db,path,new URL("http://x/api/state?q=widget&evidence=1")).body as any;assert.equal(shown.best.latestEvidence.length,1)}));
test("status API returns counts without transcript content",()=>fixture((db,path)=>{const response=apiResponse(db,path,new URL("http://x/api/status"));assert.equal(response.status,200);const json=JSON.stringify(response.body);assert.match(json,/"threads":1/);assert.doesNotMatch(json,/Repaired the widget safely/);assert.doesNotMatch(json,/excerpt|searchable_text/)}));
test("workstream detail is fixture-backed and evidence is opt-in",()=>fixture((db,path)=>{const ws=createWorkstream(db,"Widget work");addWorkstreamAlias(db,ws.id,"widget repair");assignThread(db,syntheticId(1),ws.id);const hidden=apiResponse(db,path,new URL(`http://x/api/workstreams/${ws.id}`));assert.equal(hidden.status,200);const body=hidden.body as any;assert.deepEqual(body.workstream.aliases,["widget repair"]);assert.equal(body.card.relatedThreads[0].externalId,syntheticId(1));assert.deepEqual(body.card.latestEvidence,[]);const shown=apiResponse(db,path,new URL(`http://x/api/workstreams/${ws.id}?evidence=1`)).body as any;assert.equal(shown.card.latestEvidence.length,1)}));
