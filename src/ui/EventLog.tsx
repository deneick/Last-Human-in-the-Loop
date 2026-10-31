import type { GameEvent } from "../sim/types";

export function EventLog({ events }: { events: GameEvent[] }) {
  const recent = events.slice(-40).reverse();
  return (
    <section className="panel log">
      <h2>Ereignisprotokoll</h2>
      <ol>
        {recent.map((e, i) => (
          <li key={events.length - i} className={`sev-${e.severity}`}>
            <span className="tick">Z{e.tick}</span> {e.text}
          </li>
        ))}
      </ol>
    </section>
  );
}
