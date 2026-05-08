import { useState, useEffect } from "react";
import { useParams, useLocation } from "wouter";
import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  SparklesIcon,
  DownloadIcon,
  RefreshCwIcon,
  ArrowLeftIcon,
  ImageIcon,
  LoaderIcon,
  ZapIcon,
  PencilIcon,
  TrashIcon,
  ArrowUpIcon,
  ArrowDownIcon,
  ChevronUpIcon,
  ChevronDownIcon,
  AlertTriangleIcon,
  LayersIcon,
  CheckIcon,
  WandSparklesIcon,
  FileJsonIcon,
} from "lucide-react";
import type { Slide } from "../../../drizzle/schema";
import { STATUS_CONFIG } from "@/const";

export default function StoryDetail() {
  const params = useParams<{ id: string }>();
  const storyId = parseInt(params.id || "0");
  const [, navigate] = useLocation();
  const [activeSlide, setActiveSlide] = useState(0);

  const utils = trpc.useUtils();

  const { data: story, isLoading } = trpc.stories.get.useQuery(
    { id: storyId },
    { refetchInterval: (data) => {
        const s = data?.state?.data;
        if (!s) return false;
        return s.status === "generating_images" || s.status === "generating_text" ? 3000 : false;
      }
    }
  );

  const generateImages = trpc.generate.generateAllImages.useMutation({
    onSuccess: (data) => {
      toast.success(`Bilder generiert! ${data.errorCount > 0 ? `${data.errorCount} Fehler.` : ""}`);
      utils.stories.get.invalidate({ id: storyId });
    },
    onError: (err) => toast.error(`Fehler: ${err.message}`),
  });

  const regenerateSlide = trpc.generate.regenerateSlide.useMutation({
    onSuccess: () => {
      toast.success("Slide neu generiert!");
      // The yellow strip auto-disappears via the refreshed slide.needsRegen=false.
      utils.stories.get.invalidate({ id: storyId });
    },
    onError: (err) => toast.error(`Fehler: ${err.message}`),
  });

  const regenerateWithFreshPrompt = trpc.generate.regenerateWithFreshPrompt.useMutation({
    onSuccess: () => {
      toast.success("Prompt neu geschrieben & Slide regeneriert");
      utils.stories.get.invalidate({ id: storyId });
      // Close the edit dialog if the user kicked it off from there.
      setEditingSlideId(null);
    },
    onError: (err) => toast.error(`Fehler: ${err.message}`),
  });

  const assignScene = trpc.slides.assignScene.useMutation({
    onSuccess: () => {
      toast.success("Slide neuer Scene zugewiesen");
      // Server flips slide.needsRegen=true; UI re-reads after invalidate.
      utils.stories.get.invalidate({ id: storyId });
      setScenePopoverOpen(false);
    },
    onError: (err) => toast.error(`Fehler: ${err.message}`),
  });

  const deleteStory = trpc.stories.delete.useMutation({
    onSuccess: () => { toast.success("Story gelöscht"); navigate("/archive"); },
    onError: (err) => toast.error(`Fehler: ${err.message}`),
  });

  // Tracks "save then immediately regenerate" so onSuccess of updateContent
  // can chain into regenerateSlide before closing the dialog.
  const [chainRegenAfterSave, setChainRegenAfterSave] = useState(false);

  const updateSlideContent = trpc.slides.updateContent.useMutation({
    onSuccess: (_data, vars) => {
      utils.stories.get.invalidate({ id: storyId });
      if (chainRegenAfterSave) {
        setChainRegenAfterSave(false);
        regenerateSlide.mutate({ slideId: vars.slideId });
        toast.success("Gespeichert — generiere neu…");
      } else {
        toast.success("Slide gespeichert");
      }
      setEditingSlideId(null);
    },
    onError: (err) => {
      setChainRegenAfterSave(false);
      toast.error(`Fehler: ${err.message}`);
    },
  });

  const deleteSlideMutation = trpc.slides.delete.useMutation({
    onSuccess: () => {
      toast.success("Slide gelöscht");
      utils.stories.get.invalidate({ id: storyId });
      setDeleteSlideId(null);
      setActiveSlide(0);
    },
    onError: (err) => toast.error(`Fehler: ${err.message}`),
  });

  const reorderSlides = trpc.slides.reorder.useMutation({
    onSuccess: () => utils.stories.get.invalidate({ id: storyId }),
    onError: (err) => toast.error(`Fehler: ${err.message}`),
  });

  const updateConsistencyContext = trpc.stories.updateConsistencyContext.useMutation({
    onSuccess: () => {
      toast.success("Kontext aktualisiert");
      utils.stories.get.invalidate({ id: storyId });
      setCtxEditOpen(false);
    },
    onError: (err) => toast.error(`Fehler: ${err.message}`),
  });

  const updateScene = trpc.stories.updateScene.useMutation({
    onSuccess: () => {
      toast.success("Scene gespeichert");
      utils.stories.get.invalidate({ id: storyId });
      setSceneEditId(null);
    },
    onError: (err) => toast.error(`Fehler: ${err.message}`),
  });

  const reorderScenes = trpc.stories.reorderScenes.useMutation({
    onSuccess: () => {
      utils.stories.get.invalidate({ id: storyId });
    },
    onError: (err) => toast.error(`Fehler: ${err.message}`),
  });

  const removeScene = trpc.stories.removeScene.useMutation({
    onSuccess: () => {
      toast.success("Scene entfernt");
      utils.stories.get.invalidate({ id: storyId });
      setRemoveSceneId(null);
    },
    onError: (err) => toast.error(`Fehler: ${err.message}`),
  });

  // Slide-edit dialog state
  const [editingSlideId, setEditingSlideId] = useState<number | null>(null);
  const [editTextContent, setEditTextContent] = useState("");
  const [editImagePrompt, setEditImagePrompt] = useState("");
  const [editCaption, setEditCaption] = useState("");
  const [deleteSlideId, setDeleteSlideId] = useState<number | null>(null);

  // Scene-picker popover state
  const [scenePopoverOpen, setScenePopoverOpen] = useState(false);

  // ConsistencyContext edit state
  const [ctxEditOpen, setCtxEditOpen] = useState(false);
  const [ctxColorPalette, setCtxColorPalette] = useState("");
  const [ctxGlobalStylePrompt, setCtxGlobalStylePrompt] = useState("");

  // Scene-edit dialog state (per-scene environment / lock / transition)
  const [sceneEditId, setSceneEditId] = useState<string | null>(null);
  const [sceneEditEnv, setSceneEditEnv] = useState("");
  const [sceneEditLock, setSceneEditLock] = useState("");
  const [sceneEditTransition, setSceneEditTransition] = useState("");

  // Scene-remove confirm state (sceneId of scene the user wants to drop).
  const [removeSceneId, setRemoveSceneId] = useState<string | null>(null);

  const handleExportZip = async () => {
    if (!story?.slides) return;
    const completedSlides = story.slides.filter((s: Slide) => s.imageUrl);
    if (completedSlides.length === 0) { toast.error("Keine fertigen Bilder zum Exportieren"); return; }

    toast.info("ZIP wird erstellt...");
    try {
      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();
      const folder = zip.folder(story.title || "story")!;

      await Promise.all(
        completedSlides.map(async (slide: Slide) => {
          const response = await fetch(slide.imageUrl!);
          const blob = await response.blob();
          folder.file(`slide-${String(slide.slideNumber).padStart(2, "0")}.png`, blob);
        })
      );

      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(story.title || "story").replace(/[^a-z0-9]/gi, "-").toLowerCase()}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("ZIP heruntergeladen!");
    } catch {
      toast.error("ZIP-Export fehlgeschlagen. JSZip nicht verfügbar.");
    }
  };

  const openEditSlide = (slide: Slide) => {
    setEditingSlideId(slide.id);
    setEditTextContent(slide.textContent ?? "");
    setEditImagePrompt(slide.imagePrompt ?? "");
    setEditCaption(slide.caption ?? "");
  };

  const handleSaveSlide = (alsoRegenerate = false) => {
    if (editingSlideId === null) return;
    setChainRegenAfterSave(alsoRegenerate);
    updateSlideContent.mutate({
      slideId: editingSlideId,
      textContent: editTextContent,
      imagePrompt: editImagePrompt,
      caption: editCaption,
    });
  };

  const handleMoveSlide = (idx: number, dir: -1 | 1) => {
    if (!story?.slides) return;
    const arr = [...story.slides];
    const target = idx + dir;
    if (target < 0 || target >= arr.length) return;
    [arr[idx], arr[target]] = [arr[target], arr[idx]];
    reorderSlides.mutate({ storyId, slideIds: arr.map((s) => s.id) });
    setActiveSlide(target);
  };

  const handleMoveScene = (idx: number, dir: -1 | 1, orderedIds: string[]) => {
    const target = idx + dir;
    if (target < 0 || target >= orderedIds.length) return;
    const next = orderedIds.slice();
    [next[idx], next[target]] = [next[target], next[idx]];
    reorderScenes.mutate({ storyId, sceneIds: next });
  };

  // Seed consistency context edit fields when dialog opens
  useEffect(() => {
    if (!ctxEditOpen || !story?.consistencyContext) return;
    const c = story.consistencyContext as { colorPalette?: string; globalStylePrompt?: string };
    setCtxColorPalette(c.colorPalette ?? "");
    setCtxGlobalStylePrompt(c.globalStylePrompt ?? "");
  }, [ctxEditOpen, story?.consistencyContext]);

  // Keyboard nav: ←/→ steps through slides. Skip when typing in inputs.
  const slideCount = story?.slides?.length ?? 0;
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || t?.isContentEditable) return;
      if (e.key === "ArrowLeft") {
        setActiveSlide((i) => (i > 0 ? i - 1 : i));
      } else if (e.key === "ArrowRight") {
        setActiveSlide((i) => (i < slideCount - 1 ? i + 1 : i));
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [slideCount]);

  const handleExportJson = () => {
    if (!story) return;
    const payload = {
      story: {
        id: story.id,
        title: story.title,
        theme: story.theme,
        status: story.status,
        imageFormat: story.imageFormat,
        imageProvider: story.imageProvider,
      },
      slides: story.slides ?? [],
      consistencyContext: story.consistencyContext ?? null,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `story-${storyId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center min-h-96">
          <LoaderIcon className="w-6 h-6 animate-spin text-primary" />
        </div>
      </AppLayout>
    );
  }

  if (!story) {
    return (
      <AppLayout>
        <div className="p-8 text-center">
          <p className="text-muted-foreground">Story nicht gefunden</p>
          <Button variant="outline" className="mt-4" onClick={() => navigate("/archive")}>Zurück zum Archiv</Button>
        </div>
      </AppLayout>
    );
  }

  const slides: Slide[] = story.slides || [];
  const completedSlides = slides.filter((s) => s.imageUrl).length;
  const hasImages = completedSlides > 0;
  const allComplete = completedSlides === slides.length && slides.length > 0;
  const isGenerating = story.status === "generating_images" || generateImages.isPending;
  const currentSlide = slides[activeSlide];

  type SceneShape = {
    id: string;
    environment?: string;
    environmentLockNotes?: string;
    transitionToNext?: string;
    slideRange?: [number, number];
  };
  const rawCtx = story.consistencyContext as
    | {
        artStyle?: string;
        colorPalette?: string;
        environment?: string;
        scenes?: SceneShape[];
        characters?: Array<{ name: string; outfit: string }>;
        slideCount?: number;
        version?: number;
      }
    | null;
  const ctx = rawCtx
    ? {
        artStyle: rawCtx.artStyle,
        colorPalette: rawCtx.colorPalette,
        // v2 stores env per scene; show first scene as headline
        environment: rawCtx.environment ?? rawCtx.scenes?.[0]?.environment ?? "",
        characters: rawCtx.characters,
        slideCount: rawCtx.slideCount,
        scenes: rawCtx.scenes,
      }
    : null;

  // Scenes are displayed in their stored order in consistencyContext.scenes;
  // that order is the source of truth (mutated by stories.reorderScenes).
  // Note: slideRange may be stale post-reorder — design doc §6 keeps that
  // as advisory, not a sort key.
  const scenes: SceneShape[] = (ctx?.scenes ?? []).slice();
  const sceneIndexById = new Map(scenes.map((s, i) => [s.id, i]));
  const sceneLabel = (sceneId: string | null | undefined): string => {
    if (!sceneId) return "Ohne Scene";
    const idx = sceneIndexById.get(sceneId);
    return idx === undefined ? sceneId : `Scene ${idx + 1}`;
  };
  const slidesByScene = new Map<string, Slide[]>();
  for (const s of scenes) slidesByScene.set(s.id, []);
  const slidesWithoutScene: Slide[] = [];
  for (const sl of slides) {
    if (sl.sceneId && slidesByScene.has(sl.sceneId)) {
      slidesByScene.get(sl.sceneId)!.push(sl);
    } else {
      slidesWithoutScene.push(sl);
    }
  }

  const storyStatus = STATUS_CONFIG[story.status as keyof typeof STATUS_CONFIG] || STATUS_CONFIG.draft;

  return (
    <AppLayout>
      <div className="p-6 lg:p-8 space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div>
            <button
              onClick={() => navigate("/archive")}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-2 transition-colors"
            >
              <ArrowLeftIcon className="w-3.5 h-3.5" />
              Zurück zum Archiv
            </button>
            <h1 className="font-display text-2xl font-bold text-foreground">{story.title}</h1>
            <p className="text-muted-foreground text-sm mt-1 line-clamp-2">{story.theme}</p>
          </div>
          <div className="flex flex-wrap gap-2 self-start">
            <Badge className={storyStatus.color}>{storyStatus.label}</Badge>
            <Badge variant="outline">{story.imageFormat}</Badge>
            <Badge variant="outline">{story.imageProvider}</Badge>
          </div>
        </div>

        {/* Action bar */}
        <div className="flex flex-wrap gap-3">
          {!hasImages || !allComplete ? (
            <Button
              onClick={() => generateImages.mutate({ storyId })}
              disabled={isGenerating}
              className="gap-2"
            >
              {isGenerating ? (
                <><LoaderIcon className="w-4 h-4 animate-spin" /> Generiert...</>
              ) : (
                <><ZapIcon className="w-4 h-4" /> {hasImages ? "Fehlende Bilder generieren" : "Alle Bilder generieren"}</>
              )}
            </Button>
          ) : null}
          {hasImages && (
            <Button variant="outline" onClick={handleExportZip} className="gap-2">
              <DownloadIcon className="w-4 h-4" />
              ZIP exportieren ({completedSlides}/10)
            </Button>
          )}
          <Button variant="outline" onClick={handleExportJson} className="gap-2">
            <FileJsonIcon className="w-4 h-4" />
            JSON exportieren
          </Button>
          <Button
            variant="ghost"
            className="gap-2 text-destructive hover:text-destructive"
            onClick={() => { if (confirm("Story wirklich löschen?")) deleteStory.mutate({ id: storyId }); }}
          >
            Löschen
          </Button>
        </div>

        {/* Consistency Context */}
        {ctx && (
          <Card className="bg-card border-border">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-3 gap-2">
                <h3 className="font-display text-sm font-semibold text-foreground flex items-center gap-2">
                  <SparklesIcon className="w-4 h-4 text-primary" />
                  Konsistenz-Kontext
                </h3>
                <Button size="sm" variant="ghost" className="gap-1.5 text-xs h-7" onClick={() => setCtxEditOpen(true)}>
                  <PencilIcon className="w-3.5 h-3.5" />
                  Bearbeiten
                </Button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                {ctx.artStyle && (
                  <div className="bg-muted rounded-lg p-3">
                    <span className="text-muted-foreground block mb-1">Kunststil</span>
                    <span className="text-foreground">{ctx.artStyle}</span>
                  </div>
                )}
                {ctx.colorPalette && (
                  <div className="bg-muted rounded-lg p-3">
                    <span className="text-muted-foreground block mb-1">Farbpalette</span>
                    <span className="text-foreground">{ctx.colorPalette}</span>
                  </div>
                )}
              </div>
              {ctx.characters && ctx.characters.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {ctx.characters.map((char: { name: string; outfit: string }) => (
                    <div key={char.name} className="bg-primary/10 border border-primary/20 rounded-lg px-3 py-1.5 text-xs">
                      <span className="text-primary font-medium">{char.name}</span>
                      <span className="text-muted-foreground ml-2">{char.outfit}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Per-scene listing — derived "Slides per scene". Each scene
                  gets an edit pencil (env / lock / transition) and, when
                  empty, a remove button. */}
              {scenes.length > 0 && (
                <div className="mt-4 border-t border-border pt-3 space-y-2">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Szenen ({scenes.length})
                  </p>
                  {scenes.map((s, i) => {
                    const sceneSlides = (slidesByScene.get(s.id) ?? [])
                      .slice()
                      .sort((a, b) => a.slideNumber - b.slideNumber);
                    const numbers = sceneSlides.map((sl) => sl.slideNumber);
                    const isEmpty = numbers.length === 0;
                    return (
                      <div key={s.id} className="bg-muted rounded-lg p-3 text-xs space-y-1">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-foreground">Scene {i + 1}</span>
                            {s.environment && (
                              <span className="text-muted-foreground">{s.environment}</span>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 whitespace-nowrap">
                            <span className="text-[11px] text-muted-foreground">
                              {isEmpty
                                ? "0 slides — leer"
                                : `${numbers.length} slide${numbers.length > 1 ? "s" : ""} · ${numbers.join(", ")}`}
                            </span>
                            <button
                              onClick={() => handleMoveScene(i, -1, scenes.map((sc) => sc.id))}
                              disabled={i === 0 || reorderScenes.isPending}
                              className="p-1 rounded hover:bg-primary/10 text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent"
                              title="Scene nach oben"
                            >
                              <ChevronUpIcon className="w-3 h-3" />
                            </button>
                            <button
                              onClick={() => handleMoveScene(i, 1, scenes.map((sc) => sc.id))}
                              disabled={i === scenes.length - 1 || reorderScenes.isPending}
                              className="p-1 rounded hover:bg-primary/10 text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent"
                              title="Scene nach unten"
                            >
                              <ChevronDownIcon className="w-3 h-3" />
                            </button>
                            {isEmpty && (
                              <button
                                onClick={() => setRemoveSceneId(s.id)}
                                className="text-[11px] text-destructive hover:underline"
                                title="Scene entfernen"
                              >
                                [entfernen]
                              </button>
                            )}
                            <button
                              onClick={() => {
                                setSceneEditId(s.id);
                                setSceneEditEnv(s.environment ?? "");
                                setSceneEditLock(s.environmentLockNotes ?? "");
                                setSceneEditTransition(s.transitionToNext ?? "");
                              }}
                              className="p-1 rounded hover:bg-primary/10 text-muted-foreground hover:text-foreground"
                              title="Scene bearbeiten"
                            >
                              <PencilIcon className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                        {s.environmentLockNotes && (
                          <p className="text-[11px] text-muted-foreground">
                            <span className="font-medium">Lock:</span> {s.environmentLockNotes}
                          </p>
                        )}
                        {s.transitionToNext && (
                          <p className="text-[11px] text-muted-foreground">
                            <span className="font-medium">Übergang:</span> {s.transitionToNext}
                          </p>
                        )}
                      </div>
                    );
                  })}
                  {slidesWithoutScene.length > 0 && (
                    <div className="bg-yellow-500/10 border border-yellow-500/40 rounded-lg p-3 text-xs space-y-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <AlertTriangleIcon className="w-3.5 h-3.5 text-yellow-300" />
                          <span className="font-medium text-yellow-100">Ohne Scene</span>
                        </div>
                        <span className="text-[11px] text-yellow-200/80 whitespace-nowrap">
                          {slidesWithoutScene.length} slide{slidesWithoutScene.length > 1 ? "s" : ""}
                          {" · "}
                          {slidesWithoutScene.map((sl) => sl.slideNumber).sort((a, b) => a - b).join(", ")}
                        </span>
                      </div>
                      <p className="text-[11px] text-yellow-200/80">
                        Slides ohne Scene-Zuordnung — über das Scene-Dropdown am aktiven Slide zuweisen.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Main Carousel View */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main slide preview */}
          <div className="lg:col-span-2">
            {currentSlide && (
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <div className="space-y-1.5">
                    <h3 className="font-display font-semibold text-foreground">
                      Slide {currentSlide.slideNumber} / {slides.length}
                    </h3>
                    {/* Scene pill + per-slide character chips */}
                    <div className="flex items-center gap-2 flex-wrap text-xs">
                      {scenes.length > 0 && (
                        <Popover open={scenePopoverOpen} onOpenChange={setScenePopoverOpen}>
                          <PopoverTrigger asChild>
                            <button
                              className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-foreground hover:bg-primary/10 hover:border-primary/40 transition-colors"
                              title="Scene zuweisen"
                            >
                              <LayersIcon className="w-3 h-3" />
                              {sceneLabel(currentSlide.sceneId)}
                              <span className="text-muted-foreground">▾</span>
                            </button>
                          </PopoverTrigger>
                          <PopoverContent className="w-80 p-0" align="start">
                            <div className="px-3 py-2 border-b border-border">
                              <p className="text-xs font-medium text-foreground">
                                Slide {currentSlide.slideNumber} zuordnen zu …
                              </p>
                            </div>
                            <div className="max-h-64 overflow-y-auto p-1">
                              {scenes.map((s, i) => {
                                const sceneSlides = slidesByScene.get(s.id) ?? [];
                                const isCurrent = currentSlide.sceneId === s.id;
                                return (
                                  <button
                                    key={s.id}
                                    onClick={() =>
                                      assignScene.mutate({
                                        slideId: currentSlide.id,
                                        sceneId: s.id,
                                      })
                                    }
                                    disabled={assignScene.isPending || isCurrent}
                                    className={`w-full text-left rounded-md px-2 py-1.5 text-xs flex items-start gap-2 hover:bg-muted disabled:opacity-60 ${
                                      isCurrent ? "bg-primary/10" : ""
                                    }`}
                                  >
                                    <span className="mt-0.5 w-3 inline-flex justify-center">
                                      {isCurrent ? (
                                        <CheckIcon className="w-3 h-3 text-primary" />
                                      ) : null}
                                    </span>
                                    <span className="flex-1 min-w-0">
                                      <span className="font-medium text-foreground">
                                        Scene {i + 1}
                                      </span>
                                      {s.environment && (
                                        <span className="text-muted-foreground ml-2">
                                          {s.environment}
                                        </span>
                                      )}
                                    </span>
                                    <span className="text-[11px] text-muted-foreground whitespace-nowrap">
                                      {sceneSlides.length} slide{sceneSlides.length === 1 ? "" : "s"}
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                            <div className="border-t border-border p-2 flex justify-end">
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-xs h-7"
                                onClick={() => setScenePopoverOpen(false)}
                              >
                                Schließen
                              </Button>
                            </div>
                          </PopoverContent>
                        </Popover>
                      )}
                      {currentSlide.charactersInSlide && currentSlide.charactersInSlide.length > 0 && (
                        <>
                          <span className="text-muted-foreground">·</span>
                          <span className="text-muted-foreground">Chars:</span>
                          {(currentSlide.charactersInSlide as string[]).map((name) => (
                            <span
                              key={name}
                              className="inline-flex items-center rounded-full bg-primary/10 border border-primary/20 px-2 py-0.5 text-primary text-[11px]"
                            >
                              {name}
                            </span>
                          ))}
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    {currentSlide.imageUrl && (
                      <a href={currentSlide.imageUrl} download={`slide-${currentSlide.slideNumber}.png`}>
                        <Button size="sm" variant="outline" className="gap-1.5 text-xs">
                          <DownloadIcon className="w-3.5 h-3.5" />
                          Download
                        </Button>
                      </a>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5 text-xs"
                      onClick={() => openEditSlide(currentSlide)}
                    >
                      <PencilIcon className="w-3.5 h-3.5" />
                      Bearbeiten
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5 text-xs"
                      onClick={() => regenerateSlide.mutate({ slideId: currentSlide.id })}
                      disabled={regenerateSlide.isPending || !currentSlide.imagePrompt}
                    >
                      <RefreshCwIcon className={`w-3.5 h-3.5 ${regenerateSlide.isPending ? "animate-spin" : ""}`} />
                      Neu generieren
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5 text-xs"
                      onClick={() =>
                        regenerateWithFreshPrompt.mutate({ slideId: currentSlide.id })
                      }
                      disabled={regenerateWithFreshPrompt.isPending}
                      title="Claude schreibt einen frischen imagePrompt gegen die aktuelle Scene und regeneriert dann das Bild"
                    >
                      {regenerateWithFreshPrompt.isPending ? (
                        <LoaderIcon className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <WandSparklesIcon className="w-3.5 h-3.5" />
                      )}
                      Prompt neu + Regenerate
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="gap-1.5 text-xs text-destructive hover:text-destructive"
                      onClick={() => setDeleteSlideId(currentSlide.id)}
                    >
                      <TrashIcon className="w-3.5 h-3.5" />
                      Löschen
                    </Button>
                  </div>
                </div>

                {/* Regen hint — driven by server-persisted slide.needsRegen.
                    Set true by assignScene / updateScene / imagePrompt edits;
                    reset by a successful regenerate. */}
                {currentSlide.needsRegen && (
                  <div className="flex items-start gap-3 rounded-lg border border-yellow-500/40 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-200">
                    <AlertTriangleIcon className="w-4 h-4 mt-0.5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium">Regenerate empfohlen</p>
                      <p className="text-yellow-200/70 mt-0.5">
                        Scene oder Prompt wurde geändert — das aktuelle Bild reflektiert das nicht.
                      </p>
                    </div>
                    <Button
                      size="sm"
                      className="gap-1.5 text-xs h-7"
                      onClick={() => regenerateSlide.mutate({ slideId: currentSlide.id })}
                      disabled={regenerateSlide.isPending || !currentSlide.imagePrompt}
                    >
                      <RefreshCwIcon className={`w-3.5 h-3.5 ${regenerateSlide.isPending ? "animate-spin" : ""}`} />
                      Regenerate slide
                    </Button>
                  </div>
                )}

                {/* Image display */}
                <div className={`relative bg-muted rounded-xl overflow-hidden ${story.imageFormat === "4:5" ? "aspect-[4/5]" : "aspect-square"} max-w-sm mx-auto lg:mx-0`}>
                  {currentSlide.imageUrl ? (
                    <img
                      src={currentSlide.imageUrl}
                      alt={`Slide ${currentSlide.slideNumber}`}
                      className="w-full h-full object-cover"
                    />
                  ) : currentSlide.status === "generating" ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                      <LoaderIcon className="w-8 h-8 animate-spin text-primary" />
                      <p className="text-sm text-muted-foreground">Bild wird generiert...</p>
                    </div>
                  ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
                      {currentSlide.status === "error" ? (
                        <>
                          <AlertTriangleIcon className="w-10 h-10 text-destructive/70" />
                          <p className="text-sm font-medium text-destructive">Generierung fehlgeschlagen</p>
                          {currentSlide.errorMessage && (
                            <p className="text-xs text-destructive/80 max-w-[80%]">{currentSlide.errorMessage}</p>
                          )}
                          <Button
                            size="sm"
                            className="gap-1.5 text-xs mt-1"
                            onClick={() => regenerateSlide.mutate({ slideId: currentSlide.id })}
                            disabled={regenerateSlide.isPending || !currentSlide.imagePrompt}
                          >
                            <RefreshCwIcon className={`w-3.5 h-3.5 ${regenerateSlide.isPending ? "animate-spin" : ""}`} />
                            Erneut versuchen
                          </Button>
                        </>
                      ) : (
                        <>
                          <ImageIcon className="w-10 h-10 text-muted-foreground/30" />
                          <p className="text-sm text-muted-foreground">Noch kein Bild generiert</p>
                        </>
                      )}
                    </div>
                  )}
                </div>

                {/* Slide text */}
                {currentSlide.textContent && (
                  <div className="bg-card border border-border rounded-xl p-4">
                    <p className="text-sm text-foreground leading-relaxed">{currentSlide.textContent}</p>
                    {currentSlide.caption && (
                      <p className="text-xs text-muted-foreground mt-2 italic">{currentSlide.caption}</p>
                    )}
                  </div>
                )}

                {/* Image prompt */}
                {currentSlide.imagePrompt && (
                  <details className="group">
                    <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                      Bildprompt anzeigen
                    </summary>
                    <p className="text-xs text-muted-foreground bg-muted rounded-lg p-3 mt-2 font-mono leading-relaxed">
                      {currentSlide.imagePrompt}
                    </p>
                  </details>
                )}
              </div>
            )}
          </div>

          {/* Slide thumbnails — grouped by scene */}
          <div className="space-y-3">
            <h3 className="font-display text-sm font-semibold text-foreground">
              Alle Slides ({completedSlides}/{slides.length} fertig)
            </h3>
            <div className="space-y-3 max-h-[600px] overflow-y-auto pr-1">
              {(() => {
                // Build (sceneId | null, label, slides[]) groups in scene order, then "Ohne Scene".
                const groups: Array<{ key: string; label: string; slides: Slide[] }> = [];
                if (scenes.length === 0) {
                  groups.push({ key: "_all", label: "Slides", slides });
                } else {
                  scenes.forEach((s, i) => {
                    const list = (slidesByScene.get(s.id) ?? [])
                      .slice()
                      .sort((a, b) => a.slideNumber - b.slideNumber);
                    groups.push({
                      key: s.id,
                      label: `Scene ${i + 1}${s.environment ? ` · ${s.environment}` : ""}`,
                      slides: list,
                    });
                  });
                  if (slidesWithoutScene.length > 0) {
                    groups.push({
                      key: "_orphan",
                      label: "Ohne Scene",
                      slides: slidesWithoutScene
                        .slice()
                        .sort((a, b) => a.slideNumber - b.slideNumber),
                    });
                  }
                }
                return groups.map((g) => (
                  <div key={g.key} className="space-y-1.5">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground px-1">
                      {g.label}
                    </p>
                    {g.slides.length === 0 ? (
                      <p className="text-xs text-muted-foreground px-1 italic">leer</p>
                    ) : (
                      <div className="grid grid-cols-2 lg:grid-cols-1 gap-2">
                        {g.slides.map((slide) => {
                          const i = slides.findIndex((s) => s.id === slide.id);
                          const slideStatus =
                            STATUS_CONFIG[slide.status as keyof typeof STATUS_CONFIG] ||
                            STATUS_CONFIG.pending;
                          const StatusIcon = slideStatus.icon;
                          return (
                            <div
                              key={slide.id}
                              className={`group relative rounded-lg overflow-hidden border-2 transition-all ${
                                activeSlide === i ? "border-primary" : "border-border hover:border-primary/40"
                              }`}
                            >
                              <button
                                onClick={() => setActiveSlide(i)}
                                className="w-full text-left"
                              >
                                <div className="flex items-center gap-2 p-2">
                                  <div className={`relative flex-shrink-0 ${story.imageFormat === "4:5" ? "w-10 h-12" : "w-10 h-10"} bg-muted rounded overflow-hidden`}>
                                    {slide.imageUrl ? (
                                      <img src={slide.imageUrl} alt={`Slide ${slide.slideNumber}`} className="w-full h-full object-cover" />
                                    ) : (
                                      <div className="w-full h-full flex items-center justify-center">
                                        <StatusIcon className={`w-4 h-4 ${slide.status === "generating" ? "animate-spin" : ""} text-muted-foreground`} />
                                      </div>
                                    )}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-xs font-medium text-foreground">Slide {slide.slideNumber}</p>
                                    <span className={`text-xs px-1.5 py-0.5 rounded-full ${slideStatus.color}`}>
                                      {slideStatus.label}
                                    </span>
                                  </div>
                                </div>
                              </button>
                              {/* Reorder arrows */}
                              <div className="absolute top-1 right-1 flex flex-col gap-0.5 opacity-40 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleMoveSlide(i, -1); }}
                                  disabled={i === 0 || reorderSlides.isPending}
                                  className="bg-card/90 hover:bg-primary/20 border border-border rounded p-0.5 disabled:opacity-30"
                                  title="Nach oben"
                                >
                                  <ArrowUpIcon className="w-3 h-3" />
                                </button>
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleMoveSlide(i, 1); }}
                                  disabled={i === slides.length - 1 || reorderSlides.isPending}
                                  className="bg-card/90 hover:bg-primary/20 border border-border rounded p-0.5 disabled:opacity-30"
                                  title="Nach unten"
                                >
                                  <ArrowDownIcon className="w-3 h-3" />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ));
              })()}
            </div>
          </div>
        </div>
      </div>

      {/* Slide-edit dialog */}
      <Dialog open={editingSlideId !== null} onOpenChange={(o) => !o && setEditingSlideId(null)}>
        <DialogContent className="max-w-xl bg-card border-border">
          <DialogHeader>
            <DialogTitle className="font-display">Slide bearbeiten</DialogTitle>
            <DialogDescription>
              "Speichern" aktualisiert nur den Text. "Speichern & Regenerieren" speichert
              und generiert das Bild direkt neu.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Slide-Text (im Bild sichtbar)</label>
              <Textarea
                value={editTextContent}
                onChange={(e) => setEditTextContent(e.target.value)}
                className="min-h-[80px] bg-background/50"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Image-Prompt</label>
              <Textarea
                value={editImagePrompt}
                onChange={(e) => setEditImagePrompt(e.target.value)}
                className="min-h-[120px] font-mono text-xs bg-background/50"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Caption (Instagram)</label>
              <Input
                value={editCaption}
                onChange={(e) => setEditCaption(e.target.value)}
                className="bg-background/50"
              />
            </div>
            <div className="flex gap-2 pt-2 flex-wrap sm:flex-nowrap">
              <Button variant="outline" className="flex-1" onClick={() => setEditingSlideId(null)}>
                Abbrechen
              </Button>
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => handleSaveSlide(false)}
                disabled={updateSlideContent.isPending || regenerateSlide.isPending}
              >
                {updateSlideContent.isPending && !chainRegenAfterSave
                  ? "Speichert…"
                  : "Speichern"}
              </Button>
              <Button
                className="flex-1 gap-1.5"
                onClick={() => handleSaveSlide(true)}
                disabled={updateSlideContent.isPending || regenerateSlide.isPending}
              >
                {(updateSlideContent.isPending && chainRegenAfterSave) ||
                regenerateSlide.isPending ? (
                  <>
                    <LoaderIcon className="w-3.5 h-3.5 animate-spin" />
                    Generiert…
                  </>
                ) : (
                  <>
                    <ZapIcon className="w-3.5 h-3.5" />
                    Speichern &amp; Regenerieren
                  </>
                )}
              </Button>
            </div>
            <div className="pt-1">
              <Button
                variant="ghost"
                size="sm"
                className="w-full gap-1.5 text-xs"
                onClick={() =>
                  editingSlideId !== null &&
                  regenerateWithFreshPrompt.mutate({ slideId: editingSlideId })
                }
                disabled={regenerateWithFreshPrompt.isPending || editingSlideId === null}
                title="Claude schreibt einen frischen imagePrompt basierend auf der aktuellen Scene"
              >
                {regenerateWithFreshPrompt.isPending ? (
                  <>
                    <LoaderIcon className="w-3.5 h-3.5 animate-spin" />
                    Prompt wird neu geschrieben…
                  </>
                ) : (
                  <>
                    <WandSparklesIcon className="w-3.5 h-3.5" />
                    Prompt von Claude neu schreiben
                  </>
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete-slide confirm */}
      <AlertDialog open={deleteSlideId !== null} onOpenChange={(o) => !o && setDeleteSlideId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Slide löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              Diese Aktion kann nicht rückgängig gemacht werden.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteSlideId !== null && deleteSlideMutation.mutate({ slideId: deleteSlideId })}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Löschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Scene-edit dialog — env / lock / transition. Triggers updateScene
          which flags every slide in this scene as needsRegen. */}
      <Dialog
        open={sceneEditId !== null}
        onOpenChange={(o) => !o && setSceneEditId(null)}
      >
        <DialogContent className="max-w-xl bg-card border-border">
          <DialogHeader>
            <DialogTitle className="font-display">
              {(() => {
                const idx = sceneEditId ? sceneIndexById.get(sceneEditId) : undefined;
                return idx === undefined
                  ? "Scene bearbeiten"
                  : `Scene ${idx + 1} bearbeiten`;
              })()}
            </DialogTitle>
            <DialogDescription>
              Änderungen wirken nur auf zukünftige Bild-Generierungen.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Environment</label>
              <Textarea
                value={sceneEditEnv}
                onChange={(e) => setSceneEditEnv(e.target.value)}
                className="min-h-[60px] bg-background/50 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Lock-Notes</label>
              <Textarea
                value={sceneEditLock}
                onChange={(e) => setSceneEditLock(e.target.value)}
                className="min-h-[60px] bg-background/50 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Übergang zur nächsten Scene <span className="text-muted-foreground/60">(optional)</span>
              </label>
              <Textarea
                value={sceneEditTransition}
                onChange={(e) => setSceneEditTransition(e.target.value)}
                className="min-h-[60px] bg-background/50 text-sm"
              />
            </div>
            <div className="flex items-start gap-2 rounded-lg border border-yellow-500/40 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-200">
              <AlertTriangleIcon className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <p>
                Slides mit dieser Scene werden als <span className="font-medium">"Regenerate empfohlen"</span> markiert.
              </p>
            </div>
            <div className="flex gap-3 pt-2">
              <Button variant="outline" className="flex-1" onClick={() => setSceneEditId(null)}>
                Abbrechen
              </Button>
              <Button
                className="flex-1"
                onClick={() => {
                  if (!sceneEditId) return;
                  updateScene.mutate({
                    storyId,
                    sceneId: sceneEditId,
                    patch: {
                      environment: sceneEditEnv,
                      environmentLockNotes: sceneEditLock,
                      transitionToNext: sceneEditTransition || null,
                    },
                  });
                }}
                disabled={updateScene.isPending}
              >
                {updateScene.isPending ? "Speichert…" : "Speichern"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Scene-remove confirm — only triggered for empty scenes. */}
      <AlertDialog
        open={removeSceneId !== null}
        onOpenChange={(o) => !o && setRemoveSceneId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Scene entfernen?</AlertDialogTitle>
            <AlertDialogDescription>
              Diese Scene ist leer und wird aus dem Konsistenz-Kontext gelöscht.
              Die übrigen Scenes werden nicht umnummeriert.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                removeSceneId !== null &&
                removeScene.mutate({ storyId, sceneId: removeSceneId })
              }
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Entfernen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Consistency-context edit dialog */}
      <Dialog open={ctxEditOpen} onOpenChange={setCtxEditOpen}>
        <DialogContent className="max-w-xl bg-card border-border">
          <DialogHeader>
            <DialogTitle className="font-display">Konsistenz-Kontext bearbeiten</DialogTitle>
            <DialogDescription>
              Wirkt auf zukünftige Bild-Generierungen. Bestehende Bilder ändern sich nicht.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Farbpalette</label>
              <Textarea
                value={ctxColorPalette}
                onChange={(e) => setCtxColorPalette(e.target.value)}
                className="min-h-[60px] bg-background/50 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Globaler Style-Prompt</label>
              <Textarea
                value={ctxGlobalStylePrompt}
                onChange={(e) => setCtxGlobalStylePrompt(e.target.value)}
                className="min-h-[100px] font-mono text-xs bg-background/50"
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              TODO: Charaktere und Szenen-Details werden hier in einer späteren Iteration editierbar.
              Aktuell nur über Re-Plan / Re-Generate änderbar.
            </p>
            <div className="flex gap-3 pt-2">
              <Button variant="outline" className="flex-1" onClick={() => setCtxEditOpen(false)}>
                Abbrechen
              </Button>
              <Button
                className="flex-1"
                onClick={() =>
                  updateConsistencyContext.mutate({
                    storyId,
                    patch: {
                      colorPalette: ctxColorPalette,
                      globalStylePrompt: ctxGlobalStylePrompt,
                    },
                  })
                }
                disabled={updateConsistencyContext.isPending}
              >
                {updateConsistencyContext.isPending ? "Speichert…" : "Speichern"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
