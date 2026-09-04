export type InspectorTabId = "evidence" | "relationships" | "provider";

export interface InspectorTab {
  readonly id: InspectorTabId;
  readonly label: string;
}

export function InspectorTabs(props: Readonly<{
  idPrefix: string;
  tabs: readonly InspectorTab[];
  selected: InspectorTabId;
  onSelect: (tab: InspectorTabId) => void;
}>) {
  return (
    <div className="inspector-tabs" role="tablist" aria-label="Event inspector views">
      {props.tabs.map((tab) => (
        <button
          type="button"
          role="tab"
          id={`${props.idPrefix}-tab-${tab.id}`}
          aria-controls={`${props.idPrefix}-panel-${tab.id}`}
          aria-selected={props.selected === tab.id}
          tabIndex={props.selected === tab.id ? 0 : -1}
          key={tab.id}
          onClick={() => props.onSelect(tab.id)}
          onKeyDown={(event) => {
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
            event.preventDefault();
            const index = props.tabs.findIndex(({ id }) => id === tab.id);
            const delta = event.key === "ArrowRight" ? 1 : -1;
            const next = props.tabs[(index + delta + props.tabs.length) % props.tabs.length]!;
            props.onSelect(next.id);
            document.getElementById(`${props.idPrefix}-tab-${next.id}`)?.focus();
          }}
        >{tab.label}</button>
      ))}
    </div>
  );
}
