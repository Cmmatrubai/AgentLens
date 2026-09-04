import { z } from "zod";

export const maximumEcmaScriptTimestamp = 8_640_000_000_000_000;

export const ecmaScriptTimestampV1Schema = z.number()
  .int()
  .min(0)
  .max(maximumEcmaScriptTimestamp);
