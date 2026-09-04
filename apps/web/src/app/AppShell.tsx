import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";

export function AppShell({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="app-shell">
      <aside className="instrument-rail" aria-label="AgentLens Flight Console">
        <div className="brand-mark">
          <span aria-hidden="true" className="brand-mark__lens"><i /><i /></span>
          <span className="brand-mark__word">AgentLens</span>
        </div>
        <nav aria-label="Primary navigation">
          <NavLink to="/runs" className={({ isActive }) => isActive ? "rail-link rail-link--active" : "rail-link"}>
            <span aria-hidden="true" className="rail-link__glyph">≋</span>
            <span className="rail-link__label">Runs</span>
          </NavLink>
        </nav>
      </aside>
      <div className="shell-main">
        <header className="top-bar">
          <span className="top-bar__product">Flight Console</span>
          <span className="connection-state">
            <span aria-hidden="true" className="connection-state__dot" />
            Local only
          </span>
        </header>
        <main className="content-frame">{children}</main>
      </div>
    </div>
  );
}
