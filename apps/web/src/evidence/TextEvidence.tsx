import { useState } from "react";

import { AvailabilityNotice } from "./AvailabilityNotice.js";

export function TextEvidence(props: Readonly<{
  title: string;
  text: string;
  truncated?: boolean;
}>) {
  const [expanded, setExpanded] = useState(false);
  return (
    <section className="evidence-text" aria-label={props.title}>
      <header>
        <h4>{props.title}</h4>
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
        >{expanded ? "Use bounded preview" : `Expand ${props.title.toLowerCase()}`}</button>
      </header>
      {props.truncated === true && <AvailabilityNotice state="truncated" />}
      <pre className={`evidence-text__scroll${expanded ? " evidence-text__scroll--expanded" : ""}`} tabIndex={0}>
        <code className="evidence-text__content">{props.text}</code>
      </pre>
    </section>
  );
}
