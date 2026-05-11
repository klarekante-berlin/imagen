import { useState } from "react";
import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  Plus, Pencil, FolderIcon, ChevronDown, ChevronUp, Loader2,
} from "lucide-react";
import { IMAGE_FORMATS, type ImageFormat } from "../../../drizzle/schema";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ProjectFormState {
  name: string;
  description: string;
  imageFormat: string;
  planSystemPrompt: string;
  writeSystemPrompt: string;
  globalStylePrompt: string;
  minFrames: number;
  maxFrames: number;
  allowedAssetCategories: string[];
}

const DEFAULT_FORM: ProjectFormState = {
  name: "",
  description: "",
  imageFormat: "1:1",
  planSystemPrompt: "",
  writeSystemPrompt: "",
  globalStylePrompt: "",
  minFrames: 5,
  maxFrames: 10,
  allowedAssetCategories: [],
};

const ASSET_CATEGORIES = [
  "familie", "politiker", "historisch", "sport", "musik", "tech-ceo",
  "tiere", "umgebungen", "fahrzeuge", "stil-referenz", "sonstiges",
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function Projects() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<ProjectFormState>(DEFAULT_FORM);
  const [promptsOpen, setPromptsOpen] = useState(false);

  const { data: projects, refetch } = trpc.projects.list.useQuery();
  const createMutation = trpc.projects.create.useMutation();
  const updateMutation = trpc.projects.update.useMutation();

  const openCreate = () => {
    setEditingId(null);
    setForm(DEFAULT_FORM);
    setPromptsOpen(false);
    setDialogOpen(true);
  };

  const openEdit = (p: NonNullable<typeof projects>[number]) => {
    setEditingId(p.id);
    setForm({
      name: p.name,
      description: p.description ?? "",
      imageFormat: p.imageFormat ?? "1:1",
      planSystemPrompt: p.planSystemPrompt ?? "",
      writeSystemPrompt: p.writeSystemPrompt ?? "",
      globalStylePrompt: p.globalStylePrompt ?? "",
      minFrames: p.minFrames ?? 5,
      maxFrames: p.maxFrames ?? 10,
      allowedAssetCategories: (p.allowedAssetCategories as string[] | null) ?? [],
    });
    setPromptsOpen(false);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error("Name ist erforderlich"); return; }
    try {
      if (editingId !== null) {
        await updateMutation.mutateAsync({ id: editingId, ...form, imageFormat: form.imageFormat as ImageFormat });
        toast.success("Projekt aktualisiert");
      } else {
        await createMutation.mutateAsync({ ...form, imageFormat: form.imageFormat as ImageFormat });
        toast.success("Projekt erstellt");
      }
      setDialogOpen(false);
      refetch();
    } catch (err) {
      toast.error("Fehler: " + (err instanceof Error ? err.message : "Unbekannt"));
    }
  };

  const toggleCategory = (cat: string) => {
    setForm((f) => ({
      ...f,
      allowedAssetCategories: f.allowedAssetCategories.includes(cat)
        ? f.allowedAssetCategories.filter((c) => c !== cat)
        : [...f.allowedAssetCategories, cat],
    }));
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;

  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Projekte</h1>
            <p className="text-muted-foreground mt-1 text-sm">
              Projekte definieren Format, Stil-Prompts und erlaubte Asset-Kategorien für den Story Generator.
            </p>
          </div>
          <Button onClick={openCreate} className="gap-2">
            <Plus className="w-4 h-4" /> Neues Projekt
          </Button>
        </div>

        {/* Project list */}
        {!projects ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Lade Projekte…
          </div>
        ) : projects.length === 0 ? (
          <Card className="border-dashed border-border/50">
            <CardContent className="flex flex-col items-center justify-center py-16 gap-3 text-center">
              <FolderIcon className="w-10 h-10 text-muted-foreground/40" />
              <p className="text-muted-foreground text-sm">Noch keine Projekte.</p>
              <Button variant="outline" onClick={openCreate} className="gap-2">
                <Plus className="w-4 h-4" /> Erstes Projekt erstellen
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {projects.map((p) => (
              <Card key={p.id} className="border-border/50 bg-card/50 hover:border-border transition-colors">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base font-semibold">{p.name}</CardTitle>
                    <Button
                      variant="ghost" size="icon"
                      className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
                      onClick={() => openEdit(p)}
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                  {p.description && (
                    <p className="text-xs text-muted-foreground leading-relaxed">{p.description}</p>
                  )}
                </CardHeader>
                <CardContent className="pt-0 space-y-2">
                  <div className="flex flex-wrap gap-1.5">
                    <Badge variant="secondary" className="text-[10px]">{p.imageFormat ?? "1:1"}</Badge>
                    <Badge variant="secondary" className="text-[10px]">
                      {p.minFrames ?? 5}–{p.maxFrames ?? 10} Slides
                    </Badge>
                    {p.globalStylePrompt && (
                      <Badge variant="outline" className="text-[10px] border-primary/30 text-primary/70">
                        Style-Prompt aktiv
                      </Badge>
                    )}
                    {p.planSystemPrompt && (
                      <Badge variant="outline" className="text-[10px] border-amber-500/30 text-amber-400">
                        Plan-Prompt aktiv
                      </Badge>
                    )}
                  </div>
                  {Array.isArray(p.allowedAssetCategories) && p.allowedAssetCategories.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {(p.allowedAssetCategories as string[]).map((c) => (
                        <span key={c} className="text-[9px] px-1.5 py-0.5 rounded bg-background/60 border border-border/40 text-muted-foreground">
                          {c}
                        </span>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId !== null ? "Projekt bearbeiten" : "Neues Projekt"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Name */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Name *</label>
              <Input
                placeholder="z.B. klarekante Instagram, Buch-Artwork, YouTube-Thumbnails"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>

            {/* Description */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Beschreibung</label>
              <Input
                placeholder="Kurze Beschreibung des Projekts"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              />
            </div>

            {/* Format + Frames */}
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Bildformat</label>
                <Select value={form.imageFormat} onValueChange={(v) => setForm((f) => ({ ...f, imageFormat: v }))}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {IMAGE_FORMATS.map((fmt) => (
                      <SelectItem key={fmt} value={fmt}>{fmt}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Min. Slides</label>
                <Input
                  type="number" min={1} max={50}
                  value={form.minFrames}
                  onChange={(e) => setForm((f) => ({ ...f, minFrames: parseInt(e.target.value, 10) || 1 }))}
                  className="h-9 text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Max. Slides</label>
                <Input
                  type="number" min={1} max={50}
                  value={form.maxFrames}
                  onChange={(e) => setForm((f) => ({ ...f, maxFrames: parseInt(e.target.value, 10) || 10 }))}
                  className="h-9 text-sm"
                />
              </div>
            </div>

            {/* Allowed asset categories */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Erlaubte Asset-Kategorien</label>
              <p className="text-xs text-muted-foreground">
                Leer lassen = alle Kategorien erlaubt. Auswahl einschränken für z.B. reine Buch-Projekte.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {ASSET_CATEGORIES.map((cat) => (
                  <button
                    key={cat}
                    onClick={() => toggleCategory(cat)}
                    className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                      form.allowedAssetCategories.includes(cat)
                        ? "bg-primary/15 border-primary/50 text-primary"
                        : "border-border/40 text-muted-foreground hover:border-border hover:text-foreground"
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>

            {/* Global style prompt */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Globaler Style-Prompt</label>
              <p className="text-xs text-muted-foreground">
                Wird an jeden Bild-Prompt angehängt. Definiert den visuellen Stil des Projekts.
              </p>
              <Textarea
                placeholder="z.B. '3D cartoon style, Pixar-inspired, vibrant colors, clean lines…'"
                value={form.globalStylePrompt}
                onChange={(e) => setForm((f) => ({ ...f, globalStylePrompt: e.target.value }))}
                className="min-h-[80px] font-mono text-xs"
              />
            </div>

            {/* Advanced: system prompts — collapsed by default */}
            <div className="border-t border-border/40 pt-3">
              <button
                onClick={() => setPromptsOpen((o) => !o)}
                className="flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                {promptsOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                Erweitert: System-Prompts überschreiben
                {(form.planSystemPrompt.trim() || form.writeSystemPrompt.trim()) && (
                  <Badge className="text-[10px] bg-amber-500/15 text-amber-400 border-amber-500/30">aktiv</Badge>
                )}
              </button>
              {promptsOpen && (
                <div className="mt-3 space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Plan-System-Prompt</label>
                    <p className="text-[10px] text-muted-foreground">
                      Überschreibt den Standard-Planungs-Prompt. Nutze {`{{FORMAT}}`}, {`{{MIN_FRAMES}}`}, {`{{MAX_FRAMES}}`} als Variablen.
                    </p>
                    <Textarea
                      placeholder="Leer lassen für Standard-Prompt…"
                      value={form.planSystemPrompt}
                      onChange={(e) => setForm((f) => ({ ...f, planSystemPrompt: e.target.value }))}
                      className="min-h-[120px] font-mono text-xs"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Write-System-Prompt</label>
                    <p className="text-[10px] text-muted-foreground">
                      Überschreibt den Standard-Schreib-Prompt. Nutze {`{{FORMAT}}`}, {`{{GLOBAL_STYLE_PROMPT}}`}, {`{{CONSISTENCY_CONTEXT}}`} als Variablen.
                    </p>
                    <Textarea
                      placeholder="Leer lassen für Standard-Prompt…"
                      value={form.writeSystemPrompt}
                      onChange={(e) => setForm((f) => ({ ...f, writeSystemPrompt: e.target.value }))}
                      className="min-h-[120px] font-mono text-xs"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Abbrechen</Button>
            <Button onClick={handleSave} disabled={isSaving} className="gap-2">
              {isSaving ? <><Loader2 className="w-4 h-4 animate-spin" /> Speichere…</> : "Speichern"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
