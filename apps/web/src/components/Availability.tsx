export function Availability(props: Readonly<{
  label: string;
  value?: string;
  unavailableReason?: string;
}>) {
  return (
    <span className="availability">
      <span className="availability__label">{props.label}</span>
      <span className={props.value === undefined ? "availability__value availability__value--unavailable" : "availability__value"}>
        {props.value ?? `Unavailable: ${props.unavailableReason ?? "not captured"}`}
      </span>
    </span>
  );
}
