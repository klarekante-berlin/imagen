import { Route, Switch } from "wouter";
import Home from "./pages/Home";
import ProjectDetail from "./pages/ProjectDetail";

export default function App() {
  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
      <header className="border-b border-[var(--border)] bg-[var(--surface)]">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="text-lg font-semibold tracking-tight">Imagen</span>
            <span className="rounded-full bg-[var(--surface-muted)] px-2 py-0.5 text-xs text-[var(--text-muted)]">
              v4
            </span>
          </div>
          <nav className="flex items-center gap-4 text-sm text-[var(--text-muted)]">
            <a href="/" className="hover:text-[var(--text)]">
              Projects
            </a>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-10">
        <Switch>
          <Route path="/" component={Home} />
          <Route path="/projects/:id" component={ProjectDetail} />
          <Route>
            <div className="text-[var(--text-muted)]">Not found.</div>
          </Route>
        </Switch>
      </main>
    </div>
  );
}
