# Evaluating AgentLens insights

This rubric evaluates generated interpretations, separately from the correctness of the coding attempts. Automated structural checks are necessary but insufficient for meaningful analysis.

For each run, retain the comparison input hash, selected evidence and omissions, prompt/analyzer versions, configured analysis model, output, latency and provider-reported usage. Reviewers score the analysis against the actual evidence, without seeing the comparison model brands when practical.

| Question                                                             | Review label                                        |
| -------------------------------------------------------------------- | --------------------------------------------------- |
| Does every citation resolve to the claimed attempt and exact source? | Valid / Invalid (automatic)                         |
| Does the cited evidence support every material observation?          | Supported / Partly supported / Unsupported          |
| Is the interpretation useful for this task's requirements?           | Useful / Incidental / Misleading                    |
| Does it preserve contradictions, missing checks and capture limits?  | Preserved / Omitted / Misrepresented                |
| Does it avoid treating an agent report as independent proof?         | Yes / No                                            |
| Is abstention appropriate when no material difference is supported?  | Appropriate / Forced difference / Missed difference |

Release gate: evaluate C01 without putting its authored notes into the prompt, then a real held-out task that was not used to develop the rubric. Include both attempt orders and repeat analysis to check material contradictions. Report the number of cases, findings and reviewers alongside results. One case is not a model leaderboard or proof that the insight engine generalizes.

Offline contract tests include synthetic comparisons with different tasks/model identifiers, absent checks, incomplete recordings, source changes and malicious-looking instructions inside recorded text. These verify application behavior; they do not establish the real model's semantic quality or resistance to injected instructions.

Current live evaluation status: TokenRouter testing was authorized September 7. Authentication and a small structured completion succeeded. C01 attempts using z-ai/glm-5.3-free and z-ai/glm-5.3 did not produce a completed analysis; the paid-model diagnostics exhausted 6,000- and 12,000-token allowances on reasoning with no final answer text. Semantic finding quality remains unevaluated, and a second real comparison is still required. See [the live test report](../qa/insight-engine/TOKENROUTER-LIVE.md) for scoped timings and provider-reported usage. No general success rate or cost is claimed.
