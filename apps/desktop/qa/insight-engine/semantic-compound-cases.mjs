import {buildSemanticCases as baseline} from './semantic-cases.mjs';
export const SEMANTIC_SUITE_VERSION='semantic-compound-v1';
export function buildSemanticCases(){return baseline().map(c=>{
 const targetText=c.draft.findings[0].summary;
 c.draft.findings[0].summary=`North and South each have a supplied command excerpt. ${targetText} This pair supplies no independent check outcomes.`;
 return {...c,targetText};
});}
