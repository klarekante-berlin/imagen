import { useState, useCallback } from "react";
import { useLocation } from "wouter";
import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  Sparkles, Wand2, Users, ChevronDown, ChevronUp, ImageIcon,
  Loader2, MapPin, ChevronRight,
} from "lucide-react";

// ─── Types matching server/storyPlanner.ts ────────────────────────────────────

import type { Scene, DetectedEntity } from "@shared/types";

interface PlanState {
  title: string;
  reasoning: string;
  suggestedSlideCount: number;     // server proposal — readonly
  slideCount: number;              // editable by user (initially = suggested)
  scenes: Scene[];
  entities: Array<DetectedEntity & { overrideAssetId?: number | null }>;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function StoryGenerator() {
  const [, navigate] = useLocation();

  const [theme, setTheme] = useState("");
  const [plan, setPlan] = useState<PlanState | null>(null);
  const [model, setModel] = useState<"claude-sonnet-4-6" | "claude-opus-4-5">("claude-sonnet-4-6");
  const [imageFormat, setImageFormat] = useState<"1:1" | "4:5">("1:1");
  const [showAssetPicker, setShowAssetPicker] = useState<string | null>(null); // entity name
  const [pickerCategory, setPickerCategory] = useState<string>("");
  const [scenesOpen, setScenesOpen] = useState(true);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [customSystemPrompt, setCustomSystemPrompt] = useState("");
  const [customUserPromptPrefix, setCustomUserPromptPrefix] = useState("");

  const { data: allAssets } = trpc.assets.list.useQuery(
    { category: pickerCategory || undefined },
    { enabled: showAssetPicker !== null },
  );
  const { data: categories } = trpc.assets.categories.useQuery();

  const planMutation = trpc.stories.plan.useMutation();
  const generateMutation = trpc.stories.generate.useMutation();

  // ─── Plan ─────────────────────────────────────────────────────────────────

  const handlePlan = useCallback(async () => {
    if (!theme.trim()) { toast.error("Bitte gib ein Thema oder Skript ein"); return; }
    try {
      const result = await planMutation.mutateAsync({
        theme,
        model,
        customSystemPrompt: customSystemPrompt.trim() || undefined,
        customUserPromptPrefix: customUserPromptPrefix.trim() || undefined,
      });
      setPlan({
        title: result.title,
        reasoning: result.reasoning,
        suggestedSlideCount: result.suggestedSlideCount,
        slideCount: result.suggestedSlideCount,
        scenes: result.scenes,
        entities: result.detectedEntities.map((e) => ({ ...e, overrideAssetId: undefined })),
      });
      toast.success(
        `Plan: "${result.title}" — ${result.suggestedSlideCount} Slides, ${result.scenes.length} Scene${result.scenes.length > 1 ? "s" : ""}`,
      );
    } catch (err) {
      toast.error("Fehler beim Planen: " + (err instanceof Error ? err.message : "Unbekannt"));
    }
  }, [theme, model, planMutation, customSystemPrompt, customUserPromptPrefix]);

  // ─── Generate ─────────────────────────────────────────────────────────────

  const handleGenerate = useCallback(async () => {
    if (!plan) return;
    const overridesByName: Record<string, number | null> = {};
    for (const e of plan.entities) {
      if (e.overrideAssetId !== undefined) overridesByName[e.name] = e.overrideAssetId;
    }
    // Adjust scenes if slideCount changed: clamp last scene to slideCount
    const adjustedScenes = adjustScenesToSlideCount(plan.scenes, plan.slideCount);

    try {
      const result = await generateMutation.mutateAsync({
        theme,
        plan: {
          title: plan.title,
          suggestedSlideCount: plan.slideCount,
          reasoning: plan.reasoning,
          scenes: adjustedScenes,
          detectedEntities: plan.entities.map((e) => ({
            name: e.name,
            type: e.type,
            matchedCharacterId: e.matchedCharacterId,
            matchedAssetIds: e.matchedAssetIds,
            needsWorldBuilding: e.needsWorldBuilding,
            draftVisualDescription: e.draftVisualDescription ?? undefined,
          })),
        },
        selectedAssetIdsByEntity: overridesByName,
        model,
        imageFormat,
        imageProvider: "gpt-image-2",
        customSystemPrompt: customSystemPrompt.trim() || undefined,
        customUserPromptPrefix: customUserPromptPrefix.trim() || undefined,
      });
      toast.success(`Story "${result.title}" erstellt!`);
      navigate(`/story/${result.storyId}`);
    } catch (err) {
      toast.error("Fehler: " + (err instanceof Error ? err.message : "Unbekannt"));
    }
  }, [theme, plan, model, imageFormat, generateMutation, navigate, customSystemPrompt, customUserPromptPrefix]);

  // ─── Helpers ──────────────────────────────────────────────────────────────

  const updateEntity = (name: string, patch: Partial<PlanState["entities"][number]>) => {
    setPlan((p) =>
      p ? { ...p, entities: p.entities.map((e) => (e.name === name ? { ...e, ...patch } : e)) } : p,
    );
  };

  const updateScene = (id: string, patch: Partial<Scene>) => {
    setPlan((p) =>
      p ? { ...p, scenes: p.scenes.map((s) => (s.id === id ? { ...s, ...patch } : s)) } : p,
    );
  };

  const isPlanning = planMutation.isPending;
  const isGenerating = generateMutation.isPending;

  const characterEntities = plan?.entities.filter((e) => e.type === "character") ?? [];

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <AppLayout>
      <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Story Generator</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Theme eingeben → Claude plant Slide-Count + Scenes + erkennt Charaktere → du
            justierst → Story wird mit referenzbasierter Konsistenz generiert.
          </p>
        </div>

        {/* Step 1 — Theme */}
        <Card className="border-border/50 bg-card/50">
          <CardContent className="pt-6 space-y-4">
            <StepHeader n={1} label="Thema oder Skript" />
            <Textarea
              placeholder="z.B. 'Eltern-Burnout als Systemmord auf Raten' – oder füge dein Skript ein…"
              value={theme}
              onChange={(e) => {
                setTheme(e.target.value);
                if (plan) setPlan(null); // theme change invalidates plan
              }}
              className="min-h-[140px] resize-none font-mono text-sm bg-background/50"
            />
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex flex-wrap gap-1.5">
                {[
                  "Eltern-Burnout als Systemmord auf Raten",
                  "Olaf Scholz und die Zeitenwende",
                  "Familie beim Frühstück, dann Streit, dann Versöhnung",
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
                onClick={handlePlan}
                disabled={!theme.trim() || isPlanning}
                variant="outline"
                size="sm"
                className="gap-2 shrink-0"
              >
                {isPlanning ? <><Loader2 className="w-4 h-4 animate-spin" /> Plane…</>
                  : <><Sparkles className="w-4 h-4" /> Plan erstellen</>}
              </Button>
            </div>

            {/* Advanced prompt overrides — power user */}
            <div className="border-t border-border/40 pt-3">
              <button
                onClick={() => setAdvancedOpen((o) => !o)}
                className="flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                {advancedOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                Erweitert (Prompt-Überschreibung)
                {(customSystemPrompt.trim() || customUserPromptPrefix.trim()) && (
                  <Badge className="text-[10px] bg-amber-500/15 text-amber-400 border-amber-500/30">aktiv</Badge>
                )}
              </button>
              {advancedOpen && (
                <div className="mt-3 space-y-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">
                      System-Prompt überschreiben (optional)
                    </label>
                    <Textarea
                      placeholder="Leer lassen für Default. Wirkt auf Plan + Generate."
                      value={customSystemPrompt}
                      onChange={(e) => setCustomSystemPrompt(e.target.value)}
                      className="min-h-[80px] font-mono text-xs bg-background/50"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">
                      User-Prompt-Präfix (optional)
                    </label>
                    <Textarea
                      placeholder="Wird vor dem auto-generierten User-Template eingefügt."
                      value={customUserPromptPrefix}
                      onChange={(e) => setCustomUserPromptPrefix(e.target.value)}
                      className="min-h-[60px] font-mono text-xs bg-background/50"
                    />
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Step 2 — Plan */}
        {plan && (
          <Card className="border-border/50 bg-card/50">
            <CardContent className="pt-6 space-y-5">
              <StepHeader n={2} label={`Plan: "${plan.title}"`} />

              <p className="text-xs text-muted-foreground italic leading-relaxed">
                {plan.reasoning}
              </p>

              {/* Slide-count slider */}
              <div className="space-y-2 p-3 rounded-lg bg-background/30 border border-border/40">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium">Slide-Anzahl</label>
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-bold text-primary text-lg">{plan.slideCount}</span>
                    {plan.slideCount !== plan.suggestedSlideCount && (
                      <span className="text-xs text-muted-foreground">
                        (Vorschlag: {plan.suggestedSlideCount})
                      </span>
                    )}
                  </div>
                </div>
                <input
                  type="range" min={3} max={10} step={1}
                  value={plan.slideCount}
                  onChange={(e) => setPlan((p) => p ? { ...p, slideCount: parseInt(e.target.value, 10) } : p)}
                  className="w-full accent-primary"
                />
                <div className="flex justify-between text-[10px] text-muted-foreground">
                  <span>3</span><span>4</span><span>5</span><span>6</span><span>7</span><span>8</span><span>9</span><span>10</span>
                </div>
              </div>

              {/* Scenes */}
              <div className="space-y-2">
                <button
                  onClick={() => setScenesOpen(!scenesOpen)}
                  className="flex items-center gap-2 text-sm font-medium hover:text-primary transition-colors"
                >
                  {scenesOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  <MapPin className="w-4 h-4" />
                  Scenes ({plan.scenes.length})
                </button>
                {scenesOpen && (
                  <div className="space-y-2 ml-1">
                    {plan.scenes.map((s) => (
                      <div key={s.id} className="p-3 rounded-lg bg-background/30 border border-border/40 space-y-2">
                        <div className="flex items-center justify-between">
                          <Badge variant="secondary" className="text-[10px]">
                            Slides {s.slideRange[0]}–{Math.min(s.slideRange[1], plan.slideCount)}
                          </Badge>
                          {s.id !== plan.scenes[plan.scenes.length - 1].id && (
                            <span className="text-[10px] text-muted-foreground">→ next scene</span>
                          )}
                        </div>
                        <Input
                          placeholder="Location-Beschreibung"
                          value={s.environment}
                          onChange={(e) => updateScene(s.id, { environment: e.target.value })}
                          className="text-sm bg-background/50"
                        />
                        <Input
                          placeholder="Lock-Notes (was bleibt gleich, z.B. selbe Möbel)"
                          value={s.environmentLockNotes}
                          onChange={(e) => updateScene(s.id, { environmentLockNotes: e.target.value })}
                          className="text-xs bg-background/50"
                        />
                        {s.transitionToNext !== undefined && (
                          <Input
                            placeholder="Übergang zur nächsten Scene"
                            value={s.transitionToNext ?? ""}
                            onChange={(e) => updateScene(s.id, { transitionToNext: e.target.value })}
                            className="text-xs bg-background/50"
                          />
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Detected characters */}
              {characterEntities.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Users className="w-4 h-4" />
                    Charaktere ({characterEntities.length})
                  </div>
                  <div className="space-y-2">
                    {characterEntities.map((e) => {
                      const overrideAsset = e.overrideAssetId !== undefined && e.overrideAssetId !== null
                        ? allAssets?.find((a) => a.id === e.overrideAssetId)
                        : null;
                      return (
                        <div key={e.name}>
                          <div className="flex items-center gap-3 p-3 rounded-lg border border-border/40 bg-background/30">
                            <div className="w-12 h-12 rounded-lg overflow-hidden bg-muted/30 shrink-0 border border-border/30">
                              {overrideAsset?.imageUrl ? (
                                <img src={overrideAsset.imageUrl} alt={overrideAsset.name} className="w-full h-full object-cover" />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center">
                                  <Users className="w-5 h-5 text-muted-foreground/30" />
                                </div>
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-semibold text-sm">{e.name}</span>
                                {e.character ? (
                                  <Badge className="text-[10px] bg-emerald-500/15 text-emerald-400 border-emerald-500/30">
                                    matched: {e.character.name}
                                  </Badge>
                                ) : e.needsWorldBuilding ? (
                                  <Badge className="text-[10px] bg-amber-500/15 text-amber-400 border-amber-500/30">
                                    🌍 world-build (Phase 3)
                                  </Badge>
                                ) : (
                                  <Badge variant="outline" className="text-[10px]">
                                    ohne Asset
                                  </Badge>
                                )}
                              </div>
                              {e.draftVisualDescription && !e.character && (
                                <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">
                                  {e.draftVisualDescription}
                                </p>
                              )}
                            </div>
                            <Button
                              variant="ghost" size="sm"
                              className="h-7 px-2 text-xs gap-1"
                              onClick={() => setShowAssetPicker(showAssetPicker === e.name ? null : e.name)}
                            >
                              {showAssetPicker === e.name ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                              Asset
                            </Button>
                          </div>

                          {/* Asset picker for this entity */}
                          {showAssetPicker === e.name && (
                            <div className="mt-1 border border-border/40 rounded-lg bg-background/80 p-3 space-y-3">
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-medium">Asset für "{e.name}" wählen</span>
                                <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => setShowAssetPicker(null)}>✕</Button>
                              </div>
                              <div className="flex flex-wrap gap-1.5">
                                <button
                                  onClick={() => setPickerCategory("")}
                                  className={`text-xs px-2 py-1 rounded-full border transition-colors ${!pickerCategory ? "bg-primary text-primary-foreground border-primary" : "border-border/40 hover:border-primary/50"}`}
                                >Alle</button>
                                {categories?.map((cat) => (
                                  <button
                                    key={cat}
                                    onClick={() => setPickerCategory(cat)}
                                    className={`text-xs px-2 py-1 rounded-full border transition-colors ${pickerCategory === cat ? "bg-primary text-primary-foreground border-primary" : "border-border/40 hover:border-primary/50"}`}
                                  >{cat}</button>
                                ))}
                              </div>
                              <div className="grid grid-cols-6 gap-1.5 max-h-44 overflow-y-auto">
                                <button
                                  onClick={() => { updateEntity(e.name, { overrideAssetId: null }); setShowAssetPicker(null); }}
                                  className="aspect-square rounded-lg border border-dashed border-border/40 hover:border-red-400/50 flex items-center justify-center text-xs text-muted-foreground hover:text-red-400 transition-colors"
                                  title="Kein Asset"
                                >✕</button>
                                {allAssets?.map((asset) => (
                                  <button
                                    key={asset.id}
                                    onClick={() => { updateEntity(e.name, { overrideAssetId: asset.id }); setShowAssetPicker(null); }}
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
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Step 3 — Settings + Generate */}
        <Card className="border-border/50 bg-card/50">
          <CardContent className="pt-6 space-y-4">
            <StepHeader n={plan ? 3 : 2} label="Einstellungen & Generieren" />

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">KI-Modell</label>
                <Select value={model} onValueChange={(v) => setModel(v as typeof model)}>
                  <SelectTrigger className="h-9 bg-background/50 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="claude-sonnet-4-6">Claude Sonnet 4.6 (schnell)</SelectItem>
                    <SelectItem value="claude-opus-4-5">Claude Opus 4.5 (kreativ)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Bildformat</label>
                <Select value={imageFormat} onValueChange={(v) => setImageFormat(v as typeof imageFormat)}>
                  <SelectTrigger className="h-9 bg-background/50 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1:1">1:1 Quadrat (1080×1080)</SelectItem>
                    <SelectItem value="4:5">4:5 Hochformat (1080×1350)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Button
              onClick={handleGenerate}
              disabled={!plan || isGenerating}
              className="w-full gap-2 h-11 font-semibold"
              size="lg"
            >
              {isGenerating
                ? <><Loader2 className="w-5 h-5 animate-spin" /> Story wird generiert…</>
                : <><Wand2 className="w-5 h-5" /> {plan ? `${plan.slideCount} Slides generieren` : "Erst planen"}</>}
            </Button>

            {!plan && theme.trim() && (
              <p className="text-xs text-center text-muted-foreground">
                Erst „Plan erstellen" oben klicken.
              </p>
            )}
            {isGenerating && (
              <p className="text-xs text-center text-muted-foreground animate-pulse">
                Claude schreibt {plan?.slideCount} Slides… ca. 20–40s
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function StepHeader({ n, label }: { n: number; label: string }) {
  return (
    <div className="flex items-center gap-2 mb-1">
      <div className="w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold shrink-0">{n}</div>
      <span className="font-semibold text-sm">{label}</span>
    </div>
  );
}

/**
 * If user changed slideCount via slider, clamp/expand last scene's range so
 * scenes still cover [1..slideCount] contiguously. Drops scenes whose start > slideCount.
 */
function adjustScenesToSlideCount(scenes: Scene[], slideCount: number): Scene[] {
  const kept: Scene[] = [];
  for (const s of scenes) {
    if (s.slideRange[0] > slideCount) break;
    kept.push({ ...s, slideRange: [s.slideRange[0], Math.min(s.slideRange[1], slideCount)] });
  }
  if (kept.length > 0) {
    kept[kept.length - 1] = {
      ...kept[kept.length - 1],
      slideRange: [kept[kept.length - 1].slideRange[0], slideCount],
    };
  }
  return kept;
}
