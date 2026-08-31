import type { ReactNode } from "react";

export function ErrorState(props: Readonly<{
  title: string;
  message: string;
  action?: ReactNode;
}>) {
  return (
    <section className="state-panel" aria-labelledby="state-title">
      <p className="state-panel__eyebrow">Local evidence state</p>
      <h1 id="state-title">{props.title}</h1>
      <p>{props.message}</p>
      {props.action}
    </section>
  );
}
