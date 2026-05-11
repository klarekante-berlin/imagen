import { Link, useLocation, useRoute } from "wouter";
import { CharacterEditor } from "../features/character-studio/CharacterEditor";

export default function CharacterDetail() {
  const [, params] = useRoute("/characters/:id");
  const [, setLocation] = useLocation();
  const id = params?.id ?? "";

  if (!id) return <div>Character id missing.</div>;

  return (
    <div className="space-y-4">
      <Link href="/characters" className="text-xs text-[var(--text-muted)] hover:text-[var(--text)]">
        ← All characters
      </Link>
      <CharacterEditor characterId={id} onDeleted={() => setLocation("/characters")} />
    </div>
  );
}
