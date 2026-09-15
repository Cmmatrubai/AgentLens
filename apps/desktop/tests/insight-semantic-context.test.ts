import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildSemanticCases as baseline } from '../qa/insight-engine/semantic-cases.mjs';
import { buildSemanticCases as expanded } from '../qa/insight-engine/semantic-context-cases.mjs';
import { reviewOpenAI } from '../server/insights/support-provider.mjs';
import { buildSupportUnits, buildSupportPassages, validateSupportOutput } from '../server/insights/support-schema.mjs';

test('the original semantic suite stays frozen while larger cases preserve every decisive source and claim', () => {
  const small=baseline(),large=expanded();
  assert.equal(createHash('sha256').update(JSON.stringify(small)).digest('hex'),'ecd4fd86360e5ef7ff2da02d13681caaa18c91964c1b67e2d29bc6745cb1af44');
  assert.equal(large.length,6); assert.deepEqual(large,expanded());
  for(let i=0;i<6;i++) {
    assert.deepEqual(large[i].draft,small[i].draft);
    assert.deepEqual(large[i].bundle.attempts,small[i].bundle.attempts);
    assert.deepEqual(large[i].bundle.task,small[i].bundle.task);
    assert.deepEqual(large[i].bundle.sources.slice(0,small[i].bundle.sources.length),small[i].bundle.sources);
    assert.equal(large[i].bundle.coverage.omittedSources,0);
    assert.ok(large[i].bundle.coverage.characters>35000);
    assert.ok(large[i].bundle.coverage.characters<60000);
    assert.notEqual(large[i].bundle.inputHash,small[i].bundle.inputHash);
    assert.equal(large[i].expectedVerdict,small[i].expectedVerdict);
    const extras=large[i].bundle.sources.slice(small[i].bundle.sources.length);
    assert.equal(extras.length,16);
    assert.ok(extras.every(s=>!s.truncated && !/QUEUE_LIMIT|warnOverflow|durationMs|DNS|checkout/i.test(s.excerpt)));
    const baseCatalog=buildSupportPassages(small[i].bundle).filter(p=>p.sourceId!==null);
    const catalog=buildSupportPassages(large[i].bundle);
    for(const p of baseCatalog) assert.deepEqual(catalog.find(x=>x.id===p.id),p);
  }
});

test('larger provider requests remain bounded, valid and free of evaluator labels', async () => {
  for(const c of expanded()) {
    const output={assessments:buildSupportUnits(c.draft).map(u=>({unitId:u.id,claims:[{text:u.text,verdict:'supported',reason:'Offline contract fixture.',passages:['S1:t1']}]}))};
    let bytes=0;
    await reviewOpenAI({bundle:c.bundle,draft:c.draft,model:'offline',baseUrl:'https://example.test/v1',apiFormat:'responses',outputFormat:'json_schema',fetchImpl:async (_url,options)=>{
      bytes=Buffer.byteLength(options.body);
      assert.equal(options.body.includes(c.rationale),false);
      assert.equal(options.body.includes('expectedVerdict'),false);
      return new Response(JSON.stringify({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(output)}]}]}),{status:200});
    }});
    assert.ok(bytes>35000 && bytes<200000);
    assert.doesNotThrow(()=>validateSupportOutput(c.bundle,c.draft,output));
  }
});
