import { Link, Route, Switch, useLocation } from "wouter";
import { CommandPalette } from "./features/cmdk/CommandPalette";
import CharacterDetail from "./pages/CharacterDetail";
import Characters from "./pages/Characters";
import ContentCanvas from "./pages/ContentCanvas";
import Home from "./pages/Home";
import Jobs from "./pages/Jobs";
import Library from "./pages/Library";
import ProjectDetail from "./pages/ProjectDetail";
import Templates from "./pages/Templates";
import Worlds from "./pages/Worlds";
import WorldDetail from "./pages/WorldDetail";

function NavLink({ href, label }: { href: string; label: string }) {
  const [location] = useLocation();
  const active =
    href === "/" ? location === "/" : location.startsWith(href);
  return (
    <Link
      href={href}
      className={
        active
          ? "text-[var(--text)] font-medium"
          : "text-[var(--text-muted)] hover:text-[var(--text)]"
      }
    >
      {label}
    </Link>
  );
}

export default function App() {
  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
      <header className="border-b border-[var(--border)] bg-[var(--surface)]">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-lg font-semibold tracking-tight">
              Imagen
            </Link>
            <span className="rounded-full bg-[var(--surface-muted)] px-2 py-0.5 text-xs text-[var(--text-muted)]">
              v4
            </span>
          </div>
          <nav className="flex items-center gap-5 text-sm">
            <NavLink href="/" label="Projects" />
            <NavLink href="/library" label="Library" />
            <NavLink href="/characters" label="Characters" />
            <NavLink href="/worlds" label="Worlds" />
            <NavLink href="/jobs" label="Jobs" />
            <span className="ml-2 hidden rounded-md border border-[var(--border)] px-2 py-0.5 text-[10px] text-[var(--text-muted)] sm:inline-block">
              ⌘K
            </span>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-6 py-10">
        <Switch>
          <Route path="/" component={Home} />
          <Route path="/projects/:id" component={ProjectDetail} />
          <Route path="/library" component={Library} />
          <Route path="/characters" component={Characters} />
          <Route path="/characters/:id" component={CharacterDetail} />
          <Route path="/worlds" component={Worlds} />
          <Route path="/worlds/:id" component={WorldDetail} />
          <Route path="/contents/:storyId" component={ContentCanvas} />
          <Route path="/jobs" component={Jobs} />
          <Route path="/templates" component={Templates} />
          <Route>
            <div className="text-[var(--text-muted)]">Not found.</div>
          </Route>
        </Switch>
      </main>
      <CommandPalette />
    </div>
  );
}
