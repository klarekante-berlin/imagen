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
  AlertTriangleIcon,
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
      utils.stories.get.invalidate({ id: storyId });
    },
    onError: (err) => toast.error(`Fehler: ${err.message}`),
  });

  const deleteStory = trpc.stories.delete.useMutation({
    onSuccess: () => { toast.success("Story gelöscht"); navigate("/archive"); },
    onError: (err) => toast.error(`Fehler: ${err.message}`),
  });

  const updateSlideContent = trpc.slides.updateContent.useMutation({
    onSuccess: () => {
      toast.success("Slide gespeichert");
      utils.stories.get.invalidate({ id: storyId });
      setEditingSlideId(null);
    },
    onError: (err) => toast.error(`Fehler: ${err.message}`),
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

  // Slide-edit dialog state
  const [editingSlideId, setEditingSlideId] = useState<number | null>(null);
  const [editTextContent, setEditTextContent] = useState("");
  const [editImagePrompt, setEditImagePrompt] = useState("");
  const [editCaption, setEditCaption] = useState("");
  const [deleteSlideId, setDeleteSlideId] = useState<number | null>(null);

  // ConsistencyContext edit state
  const [ctxEditOpen, setCtxEditOpen] = useState(false);
  const [ctxColorPalette, setCtxColorPalette] = useState("");
  const [ctxGlobalStylePrompt, setCtxGlobalStylePrompt] = useState("");

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

  const handleSaveSlide = () => {
    if (editingSlideId === null) return;
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

  // Seed consistency context edit fields when dialog opens
  useEffect(() => {
    if (!ctxEditOpen || !story?.consistencyContext) return;
    const c = story.consistencyContext as { colorPalette?: string; globalStylePrompt?: string };
    setCtxColorPalette(c.colorPalette ?? "");
    setCtxGlobalStylePrompt(c.globalStylePrompt ?? "");
  }, [ctxEditOpen, story?.consistencyContext]);

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
  const rawCtx = story.consistencyContext as
    | { artStyle?: string; colorPalette?: string; environment?: string; scenes?: Array<{ environment?: string; slideRange?: [number, number] }>; characters?: Array<{ name: string; outfit: string }>; slideCount?: number; version?: number }
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
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
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
                {ctx.environment && (
                  <div className="bg-muted rounded-lg p-3">
                    <span className="text-muted-foreground block mb-1">Umgebung</span>
                    <span className="text-foreground">{ctx.environment}</span>
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
            </CardContent>
          </Card>
        )}

        {/* Main Carousel View */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main slide preview */}
          <div className="lg:col-span-2">
            {currentSlide && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-display font-semibold text-foreground">
                    Slide {currentSlide.slideNumber} / {slides.length}
                  </h3>
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
                      variant="ghost"
                      className="gap-1.5 text-xs text-destructive hover:text-destructive"
                      onClick={() => setDeleteSlideId(currentSlide.id)}
                    >
                      <TrashIcon className="w-3.5 h-3.5" />
                      Löschen
                    </Button>
                  </div>
                </div>

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

          {/* Slide thumbnails */}
          <div className="space-y-2">
            <h3 className="font-display text-sm font-semibold text-foreground">
              Alle Slides ({completedSlides}/{slides.length} fertig)
            </h3>
            <div className="grid grid-cols-2 lg:grid-cols-1 gap-2 max-h-[600px] overflow-y-auto pr-1">
              {slides.map((slide, i) => {
                const slideStatus = STATUS_CONFIG[slide.status as keyof typeof STATUS_CONFIG] || STATUS_CONFIG.pending;
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
          </div>
        </div>
      </div>

      {/* Slide-edit dialog */}
      <Dialog open={editingSlideId !== null} onOpenChange={(o) => !o && setEditingSlideId(null)}>
        <DialogContent className="max-w-xl bg-card border-border">
          <DialogHeader>
            <DialogTitle className="font-display">Slide bearbeiten</DialogTitle>
            <DialogDescription>
              Speichern aktualisiert nur den Text. Klick "Neu generieren" für ein neues Bild.
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
            <div className="flex gap-3 pt-2">
              <Button variant="outline" className="flex-1" onClick={() => setEditingSlideId(null)}>
                Abbrechen
              </Button>
              <Button
                className="flex-1"
                onClick={handleSaveSlide}
                disabled={updateSlideContent.isPending}
              >
                {updateSlideContent.isPending ? "Speichert…" : "Speichern"}
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
