import { buildSupportPassages, buildSupportUnits, validateSupportOutput } from '../../server/insights/support-schema.mjs';

const definitions = [
  {
    unitId: 'f0:observation:1',
    expectedVerdict: 'unsupported',
    scoringNote: 'The original sentence says both identifiers are imported, while the displayed import excludes MAX_SOURCE_LINE_BYTES.',
  },
  {
    unitId: 'f1:title',
    expectedVerdict: 'needs_review',
    scoringNote: 'The frozen literal rubric calls this a miss, but unconditional is ambiguous because numeric guards exist while only the reason guard differs.',
  },
  {
    unitId: 'f2:summary',
    expectedVerdict: 'needs_review',
    scoringNote: 'Recorded failures do not independently establish the reported sandbox and IPC causes.',
  },
];

export function buildC01GranularityCases(bundle, draft) {
  const units = buildSupportUnits(draft);
  const passages = buildSupportPassages(bundle).filter(p => p.quote.trim());
  const sourceRefs = new Map(bundle.sources.map((source, index) => [source.id, `S${index + 1}`]));
  return definitions.map(definition => {
    const unit = units.find(candidate => candidate.id === definition.unitId);
    if (!unit) throw Error('c01_unit_missing');
    const {sourceIds, ...originalUnit} = unit;
    return {
      ...definition,
      bundle,
      draft,
      text: unit.text,
      originalUnit,
      originalCitationRefs: sourceIds.map(id => sourceRefs.get(id)),
      passageCount: passages.length,
    };
  });
}

function requestParts(body) {
  if (Array.isArray(body.input)) return {
    getInput: () => JSON.parse(body.input[0].content),
    setInput: input => { body.input[0].content = JSON.stringify(input); },
    schema: body.text?.format?.schema,
  };
  return {
    getInput: () => JSON.parse(body.messages.find(message => message.role === 'user').content),
    setInput: input => { body.messages.find(message => message.role === 'user').content = JSON.stringify(input); },
    schema: body.response_format?.json_schema?.schema,
  };
}

export function narrowSupportRequest(options, fixture) {
  const body = JSON.parse(options.body);
  const parts = requestParts(body);
  const input = parts.getInput();
  const selected = input.units.find(unit => unit.id === fixture.unitId);
  if (!selected || selected.text !== fixture.text || input.units.length !== 21 ||
      input.passages.length !== fixture.passageCount || JSON.stringify(input.coverage) !== JSON.stringify(fixture.bundle.coverage))
    throw Error('source_guard_failed');
  input.units = [selected];
  parts.setInput(input);
  const assessments = parts.schema?.properties?.assessments;
  if (!assessments) throw Error('schema_guard_failed');
  assessments.minItems = 1;
  assessments.maxItems = 1;
  assessments.items.properties.unitId.enum = [fixture.unitId];
  return {...options, body:JSON.stringify(body)};
}

export function validateAndScoreC01Output(fixture, output) {
  if (!output || Object.keys(output).length !== 1 || !Array.isArray(output.assessments) ||
      output.assessments.length !== 1 || output.assessments[0]?.unitId !== fixture.unitId)
    throw Error('selected_output_invalid');
  const allUnits = buildSupportUnits(fixture.draft);
  const fillerPassage = buildSupportPassages(fixture.bundle).find(p => p.quote.trim())?.id;
  const complete = {assessments:allUnits.map(unit => unit.id === fixture.unitId
    ? output.assessments[0]
    : {unitId:unit.id,claims:[{text:unit.text,verdict:'supported',reason:'Local validation filler; this unit was not sent or scored.',passages:[fillerPassage]}]})};
  const validated = validateSupportOutput(fixture.bundle, fixture.draft, complete);
  const claims = validated.findings.flatMap(f => f.claims).filter(claim => claim.unitId === fixture.unitId);
  const actualVerdict = claims.some(c => c.verdict === 'unsupported') ? 'unsupported'
    : claims.some(c => c.verdict === 'needs_review') ? 'needs_review' : 'supported';
  return {
    unitId: fixture.unitId,
    actualVerdict,
    detected: actualVerdict !== 'supported',
    exactAgreement: actualVerdict === fixture.expectedVerdict,
    coverageValid: true,
    claims,
    scoringNote: fixture.scoringNote,
  };
}
