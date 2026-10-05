import type { ReactNode } from "react";

/**
 * The setup and error notices: what a builder sees when the app cannot reach its
 * database, or the event is missing. Plain, in the mockup's own pieces (docs/DESIGN.md
 * §13 4.10): a card with a kicker, a title, the detail, and numbered steps.
 *
 * STAYS A SERVER COMPONENT — app/page.tsx renders it directly and must be able to keep
 * doing so without a client boundary, and `steps` stays ReactNode[] because each item
 * carries <Code> and <strong> inline.
 */
export function SetupNotice({
  title,
  detail,
  steps,
}: {
  title: string;
  detail: ReactNode;
  steps?: ReactNode[];
}) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 30,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px 20px",
        boxSizing: "border-box",
        overflowY: "auto",
        background: "var(--color-page)",
      }}
    >
      <div className="card" style={{ width: "100%", maxWidth: 560, margin: 0 }}>
        <div className="lb">SETUP</div>
        <h1 className="text-title" style={{ margin: 0, color: "var(--color-ink)" }}>
          {title}
        </h1>
        <p className="text-desc" style={{ margin: "10px 0 0", color: "var(--color-text-2)" }}>
          {detail}
        </p>
        {steps?.length ? (
          <ol style={{ margin: "18px 0 0", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 10 }}>
            {steps.map((step, i) => (
              <li key={i} className="text-desc" style={{ display: "flex", gap: 10, alignItems: "flex-start", color: "var(--color-text-2)" }}>
                <span
                  aria-hidden
                  style={{
                    flex: "none",
                    width: 22,
                    height: 22,
                    borderRadius: 7,
                    background: "var(--color-cib-blue)",
                    color: "var(--color-on-blue)",
                    fontSize: 11.5,
                    fontWeight: 700,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {i + 1}
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        ) : null}
      </div>
    </div>
  );
}

/** Inline code: a held value rather than prose; long errors wrap instead of running off the card. */
export function Code({ children }: { children: ReactNode }) {
  return (
    <code
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: "0.92em",
        background: "var(--color-chip)",
        border: "1px solid var(--color-line)",
        borderRadius: 6,
        padding: "1.5px 5px",
        color: "var(--color-ink)",
        overflowWrap: "break-word",
      }}
    >
      {children}
    </code>
  );
}
