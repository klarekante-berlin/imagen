import { useState } from "react";
import { useParams, useLocation } from "wouter";
import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  SparklesIcon,
  DownloadIcon,
  RefreshCwIcon,
  ArrowLeftIcon,
  ImageIcon,
  CheckCircleIcon,
  AlertCircleIcon,
  LoaderIcon,
  ZapIcon,
} from "lucide-react";
import type { Slide } from "../../../drizzle/schema";

const STATUS_CONFIG = {
  complete: { label: "Fertig", color: "bg-green-500/20 text-green-400", icon: CheckCircleIcon },
  error: { label: "Fehler", color: "bg-red-500/20 text-red-400", icon: AlertCircleIcon },
  generating: { label: "Generiert...", color: "bg-yellow-500/20 text-yellow-400", icon: LoaderIcon },
  pending: { label: "Ausstehend", color: "bg-muted text-muted-foreground", icon: ImageIcon },
  draft: { label: "Entwurf", color: "bg-muted text-muted-foreground", icon: ImageIcon },
  generating_text: { label: "Text wird generiert...", color: "bg-blue-500/20 text-blue-400", icon: LoaderIcon },
  generating_images: { label: "Bilder werden generiert...", color: "bg-yellow-500/20 text-yellow-400", icon: LoaderIcon },
};

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
  const ctx = story.consistencyContext as { artStyle?: string; colorPalette?: string; environment?: string; characters?: Array<{ name: string; outfit: string }> } | null;

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
              <h3 className="font-display text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                <SparklesIcon className="w-4 h-4 text-primary" />
                Konsistenz-Kontext (für alle 10 Slides gesperrt)
              </h3>
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
                  <div className="flex gap-2">
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
                      onClick={() => regenerateSlide.mutate({ slideId: currentSlide.id })}
                      disabled={regenerateSlide.isPending || !currentSlide.imagePrompt}
                    >
                      <RefreshCwIcon className={`w-3.5 h-3.5 ${regenerateSlide.isPending ? "animate-spin" : ""}`} />
                      Neu generieren
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
                      <ImageIcon className="w-10 h-10 text-muted-foreground/30" />
                      <p className="text-sm text-muted-foreground">Noch kein Bild generiert</p>
                      {currentSlide.status === "error" && currentSlide.errorMessage && (
                        <p className="text-xs text-destructive">{currentSlide.errorMessage}</p>
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
                  <button
                    key={slide.id}
                    onClick={() => setActiveSlide(i)}
                    className={`relative rounded-lg overflow-hidden border-2 transition-all text-left ${
                      activeSlide === i ? "border-primary" : "border-border hover:border-primary/40"
                    }`}
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
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
