import { useState, useCallback } from "react";
import { useLocation } from "wouter";
import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  Sparkles, Wand2, Users, CheckCircle2, XCircle, RefreshCw,
  ChevronDown, ChevronUp, ImageIcon, Loader2, AlertCircle,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface DetectedCharacter {
  name: string;
  role: string;
  confidence: "high" | "medium" | "low";
  suggestedAssetId: number | null;
  asset: {
    id: number;
    name: string;
    category: string;
    imageUrl: string | null;
    description: string | null;
    visualDescription: string | null;
  } | null;
  overrideAssetId?: number | null;
  excluded?: boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function StoryGenerator() {
  const [, navigate] = useLocation();

  const [theme, setTheme] = useState("");
  const [detectedCharacters, setDetectedCharacters] = useState<DetectedCharacter[]>([]);
  const [detectionDone, setDetectionDone] = useState(false);
  const [model, setModel] = useState<"claude-sonnet-4-6" | "claude-opus-4-5">("claude-sonnet-4-6");
  const [imageFormat, setImageFormat] = useState<"1:1" | "4:5">("1:1");
  const [showAssetPicker, setShowAssetPicker] = useState<number | null>(null);
  const [assetPickerCategory, setAssetPickerCategory] = useState<string>("");

  const { data: allAssets } = trpc.assets.list.useQuery(
    { category: assetPickerCategory || undefined },
    { enabled: showAssetPicker !== null }
  );
  const { data: categories } = trpc.assets.categories.useQuery();

  const detectMutation = trpc.detect.detectCharacters.useMutation();
  const createMutation = trpc.stories.create.useMutation();

  // ─── Detect Characters ─────────────────────────────────────────────────────

  const handleDetect = useCallback(async () => {
    if (!theme.trim()) { toast.error("Bitte gib ein Thema oder Skript ein"); return; }
    try {
      const result = await detectMutation.mutateAsync({ scriptOrTheme: theme });
      setDetectedCharacters(result.map((d) => ({ ...d })));
      setDetectionDone(true);
      if (result.length === 0) toast.info("Keine Charaktere erkannt – du kannst trotzdem fortfahren");
      else toast.success(`${result.length} Charakter${result.length > 1 ? "e" : ""} erkannt`);
    } catch (err) {
      toast.error("Fehler bei der Charakter-Erkennung: " + (err instanceof Error ? err.message : "Unbekannter Fehler"));
    }
  }, [theme, detectMutation]);

  // ─── Generate Story ────────────────────────────────────────────────────────

  const handleGenerate = useCallback(async () => {
    if (!theme.trim()) { toast.error("Bitte gib ein Thema ein"); return; }
    const selectedAssetIds = detectedCharacters
      .filter((c) => !c.excluded)
      .map((c) => c.overrideAssetId !== undefined ? c.overrideAssetId : c.suggestedAssetId)
      .filter((id): id is number => id !== null && id > 0);
    try {
      const result = await createMutation.mutateAsync({
        theme, selectedAssetIds, model, imageFormat, imageProvider: "gpt-image-2",
      });
      toast.success(`Story "${result.title}" erstellt!`);
      navigate(`/story/${result.storyId}`);
    } catch (err) {
      toast.error("Fehler: " + (err instanceof Error ? err.message : "Unbekannter Fehler"));
    }
  }, [theme, detectedCharacters, model, imageFormat, createMutation, navigate]);

  // ─── Character Card Helpers ────────────────────────────────────────────────

  const toggleExclude = (idx: number) =>
    setDetectedCharacters((prev) => prev.map((c, i) => i === idx ? { ...c, excluded: !c.excluded } : c));

  const setOverrideAsset = (charIdx: number, assetId: number | null) => {
    setDetectedCharacters((prev) =>
      prev.map((c, i) => i === charIdx ? { ...c, overrideAssetId: assetId } : c)
    );
    setShowAssetPicker(null);
  };

  const confidenceBadge = (c: string) =>
    c === "high" ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" :
    c === "medium" ? "bg-amber-500/15 text-amber-400 border-amber-500/30" :
    "bg-red-500/15 text-red-400 border-red-500/30";

  const isDetecting = detectMutation.isPending;
  const isGenerating = createMutation.isPending;
  const activeCharacters = detectedCharacters.filter((c) => !c.excluded);
  const referencedCount = activeCharacters.filter(
    (c) => (c.overrideAssetId !== undefined ? c.overrideAssetId : c.suggestedAssetId)
  ).length;

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <AppLayout>
      <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">

        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Story Generator</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Gib dein Thema oder Skript ein – das System erkennt automatisch die Charaktere aus deiner Library und nutzt die Character Sheets als visuelle Referenz.
          </p>
        </div>

        {/* Step 1: Theme Input */}
        <Card className="border-border/50 bg-card/50">
          <CardContent className="pt-6 space-y-4">
            <div className="flex items-center gap-2 mb-1">
              <div className="w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold shrink-0">1</div>
              <span className="font-semibold text-sm">Thema oder Skript eingeben</span>
            </div>
            <Textarea
              placeholder="z.B. 'Eltern-Burnout als Systemmord auf Raten' – oder füge dein komplettes Skript ein..."
              value={theme}
              onChange={(e) => {
                setTheme(e.target.value);
                if (detectionDone) { setDetectionDone(false); setDetectedCharacters([]); }
              }}
              className="min-h-[140px] resize-none font-mono text-sm bg-background/50"
            />
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex flex-wrap gap-1.5">
                {[
                  "Eltern-Burnout als Systemmord auf Raten",
                  "Olaf Scholz und die Zeitenwende",
                  "Familie Mitchell beim chaotischen Frühstück",
                ].map((ex) => (
                  <button
                    key={ex}
                    onClick={() => setTheme(ex)}
                    className="text-xs px-2.5 py-1 rounded-full border border-border/40 hover:border-primary/50 hover:bg-primary/5 transition-colors text-muted-foreground hover:text-foreground"
                  >
                    {ex.slice(0, 38)}…
                  </button>
                ))}
              </div>
              <Button
                onClick={handleDetect}
                disabled={!theme.trim() || isDetecting}
                variant="outline"
                size="sm"
                className="gap-2 shrink-0"
              >
                {isDetecting
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Erkenne…</>
                  : <><Users className="w-4 h-4" /> Charaktere erkennen</>}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Step 2: Detected Characters */}
        {detectionDone && (
          <Card className="border-border/50 bg-card/50">
            <CardContent className="pt-6 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold shrink-0">2</div>
                  <span className="font-semibold text-sm">Erkannte Charaktere</span>
                  <Badge variant="secondary" className="text-xs">{activeCharacters.length} aktiv</Badge>
                  {referencedCount > 0 && (
                    <Badge className="text-xs bg-primary/20 text-primary border-primary/30">
                      {referencedCount} mit Referenz
                    </Badge>
                  )}
                </div>
                <Button variant="ghost" size="sm" onClick={handleDetect} className="gap-1 text-xs h-7">
                  <RefreshCw className="w-3 h-3" /> Neu
                </Button>
              </div>

              {detectedCharacters.length === 0 ? (
                <div className="flex items-center gap-3 p-4 rounded-lg bg-muted/30 text-muted-foreground text-sm">
                  <AlertCircle className="w-5 h-5 shrink-0" />
                  Keine Charaktere erkannt. Das System leitet Charaktere aus dem Kontext ab.
                </div>
              ) : (
                <div className="space-y-2">
                  {detectedCharacters.map((char, idx) => {
                    const effectiveAsset =
                      char.overrideAssetId !== undefined
                        ? (allAssets?.find((a) => a.id === char.overrideAssetId) ?? char.asset)
                        : char.asset;

                    return (
                      <div key={idx}>
                        <div
                          className={`flex items-center gap-3 p-3 rounded-lg border transition-all ${
                            char.excluded
                              ? "opacity-40 border-border/20 bg-muted/10"
                              : "border-border/40 bg-background/30 hover:border-border/60"
                          }`}
                        >
                          {/* Character Sheet Thumbnail */}
                          <div className="w-14 h-14 rounded-lg overflow-hidden bg-muted/30 shrink-0 border border-border/30">
                            {effectiveAsset?.imageUrl ? (
                              <img src={effectiveAsset.imageUrl} alt={effectiveAsset.name} className="w-full h-full object-cover" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center">
                                <ImageIcon className="w-5 h-5 text-muted-foreground/30" />
                              </div>
                            )}
                          </div>

                          {/* Info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-semibold text-sm">{char.name}</span>
                              <span className="text-xs text-muted-foreground">{char.role}</span>
                              <span className={`text-[10px] px-1.5 py-0.5 rounded border ${confidenceBadge(char.confidence)}`}>
                                {char.confidence}
                              </span>
                            </div>
                            {effectiveAsset ? (
                              <p className="text-xs text-emerald-400/80 mt-0.5 truncate">
                                ✓ {effectiveAsset.name} <span className="opacity-60">({effectiveAsset.category})</span>
                              </p>
                            ) : (
                              <p className="text-xs text-amber-500/70 mt-0.5">Kein passendes Asset – wird aus Kontext generiert</p>
                            )}
                          </div>

                          {/* Actions */}
                          <div className="flex items-center gap-1 shrink-0">
                            <Button
                              variant="ghost" size="sm"
                              className="h-7 px-2 text-xs gap-1"
                              onClick={() => setShowAssetPicker(showAssetPicker === idx ? null : idx)}
                            >
                              {showAssetPicker === idx ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                              Ändern
                            </Button>
                            <Button
                              variant="ghost" size="sm"
                              className={`h-7 w-7 p-0 ${char.excluded ? "text-muted-foreground" : "text-red-400 hover:text-red-300"}`}
                              onClick={() => toggleExclude(idx)}
                              title={char.excluded ? "Einschließen" : "Ausschließen"}
                            >
                              {char.excluded ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                            </Button>
                          </div>
                        </div>

                        {/* Asset Picker for this character */}
                        {showAssetPicker === idx && (
                          <div className="mt-1 border border-border/40 rounded-lg bg-background/80 p-3 space-y-3">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-medium">Asset für "{char.name}" wählen</span>
                              <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => setShowAssetPicker(null)}>✕</Button>
                            </div>
                            {/* Category filter */}
                            <div className="flex flex-wrap gap-1.5">
                              <button
                                onClick={() => setAssetPickerCategory("")}
                                className={`text-xs px-2 py-1 rounded-full border transition-colors ${!assetPickerCategory ? "bg-primary text-primary-foreground border-primary" : "border-border/40 hover:border-primary/50"}`}
                              >
                                Alle
                              </button>
                              {categories?.map((cat) => (
                                <button
                                  key={cat}
                                  onClick={() => setAssetPickerCategory(cat)}
                                  className={`text-xs px-2 py-1 rounded-full border transition-colors ${assetPickerCategory === cat ? "bg-primary text-primary-foreground border-primary" : "border-border/40 hover:border-primary/50"}`}
                                >
                                  {cat}
                                </button>
                              ))}
                            </div>
                            {/* Asset grid */}
                            <div className="grid grid-cols-6 gap-1.5 max-h-44 overflow-y-auto">
                              <button
                                onClick={() => setOverrideAsset(idx, null)}
                                className="aspect-square rounded-lg border border-dashed border-border/40 hover:border-red-400/50 flex items-center justify-center text-xs text-muted-foreground hover:text-red-400 transition-colors"
                                title="Kein Asset"
                              >✕</button>
                              {allAssets?.map((asset) => (
                                <button
                                  key={asset.id}
                                  onClick={() => setOverrideAsset(idx, asset.id)}
                                  className="aspect-square rounded-lg overflow-hidden border border-border/30 hover:border-primary/60 transition-colors relative group"
                                  title={asset.name}
                                >
                                  {asset.imageUrl ? (
                                    <img src={asset.imageUrl} alt={asset.name} className="w-full h-full object-cover" />
                                  ) : (
                                    <div className="w-full h-full bg-muted/30 flex items-center justify-center">
                                      <ImageIcon className="w-3 h-3 text-muted-foreground/30" />
                                    </div>
                                  )}
                                  <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-1">
                                    <span className="text-[8px] text-white leading-tight line-clamp-2">{asset.name}</span>
                                  </div>
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Reference image info */}
              {referencedCount > 0 && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-primary/5 border border-primary/20 text-xs">
                  <Sparkles className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold text-primary">Reference-Image-Modus aktiv</span>
                    <p className="text-muted-foreground mt-0.5">
                      Die Character Sheets von {referencedCount} Charakter{referencedCount > 1 ? "en" : ""} werden direkt als visuelle Referenz an gpt-image-2 übergeben – für maximale Konsistenz in Aussehen, Kleidung und Stil.
                    </p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Step 3: Settings + Generate */}
        <Card className="border-border/50 bg-card/50">
          <CardContent className="pt-6 space-y-4">
            <div className="flex items-center gap-2 mb-1">
              <div className="w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold shrink-0">
                {detectionDone ? "3" : "2"}
              </div>
              <span className="font-semibold text-sm">Einstellungen & Generieren</span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">KI-Modell</label>
                <Select value={model} onValueChange={(v) => setModel(v as typeof model)}>
                  <SelectTrigger className="h-9 bg-background/50 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="claude-sonnet-4-6">Claude Sonnet 4.6 (schnell)</SelectItem>
                    <SelectItem value="claude-opus-4-5">Claude Opus 4.5 (kreativ)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Bildformat</label>
                <Select value={imageFormat} onValueChange={(v) => setImageFormat(v as typeof imageFormat)}>
                  <SelectTrigger className="h-9 bg-background/50 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1:1">1:1 Quadrat (1080×1080)</SelectItem>
                    <SelectItem value="4:5">4:5 Hochformat (1080×1350)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Button
              onClick={handleGenerate}
              disabled={!theme.trim() || isGenerating}
              className="w-full gap-2 h-11 font-semibold"
              size="lg"
            >
              {isGenerating
                ? <><Loader2 className="w-5 h-5 animate-spin" /> Story wird generiert…</>
                : <><Wand2 className="w-5 h-5" /> Story generieren</>}
            </Button>

            {isGenerating && (
              <p className="text-xs text-center text-muted-foreground animate-pulse">
                Claude erstellt 10 Slides mit narrativem Bogen… ca. 20–30 Sekunden
              </p>
            )}
          </CardContent>
        </Card>

      </div>
    </AppLayout>
  );
}
