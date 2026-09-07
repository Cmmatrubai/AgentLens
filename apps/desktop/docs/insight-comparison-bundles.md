# Using another recorded comparison

The desktop app can open a JSON comparison bundle. It stores a private local copy for analysis, and labels its provenance as supplied by the bundle author. Opening the bundle does not execute its recorded commands or fetch external source files.

The format is the existing normalized `RealComparison` object (or `{ "comparison": <object> }`) with `schemaVersion: 1` and a nonempty `taskPrompt`. Required identity fields are `id`, `title`, `manifestHash`, `promptHash`, `baseCommit` and exactly two `attempts`. Each attempt supplies a distinct `key`, `model`, `reasoningEffort`, completed normalized `run` and `checks` array. Run IDs must be distinct, and each `run.git.initialHead` must match `baseCommit`. Source evidence is inline in `run.events`, `run.git.files` and any supplied check outputs. Use actual normalized AgentLens reader output; raw provider transcripts are not this format.

The size limit is 16 MiB. Task text is limited to 20,000 characters. Independent checks may be an empty array; in that case the app can analyze recorded approaches while correctness stays unknown. Agent claims must not be inserted as independent checks. The reader recomputes displayed condition counts and ignores authored insight notes in imported files.

Imported identities and check provenance are declarations from the bundle author. AgentLens validates structure, matching bases and source associations, but import does not authenticate the original recording process. Keep the recorder's original database/artifacts and experiment manifest if the comparison will support a case study.

Choose **Use C01** to return to the original preserved experiment. No original recording is changed by selecting another comparison. The general task execution workflow remains separate; setup demo runs still use sample data.
