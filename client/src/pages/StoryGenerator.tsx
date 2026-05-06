import { useState } from "react";
import { useLocation } from "wouter";
import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  SparklesIcon,
  ImageIcon,
  CheckIcon,
  XIcon,
  ChevronDownIcon,
  ChevronUpIcon,
} from "lucide-react";

const CATEGORY_LABELS: Record<string, string> = {
  familie: "Familie",
  historisch: "Historisch",
  sport: "Sport",
  musik: "Musik",
  politiker: "Politiker",
  "tech-ceo": "Tech CEOs",
  tiere: "Tiere",
  umgebungen: "Umgebungen",
  fahrzeuge: "Fahrzeuge",
  items: "Items",
  sonstiges: "Sonstiges",
};

const EXAMPLE_THEMES = [
  "Die Familie Mitchell macht einen Roadtrip nach Hamburg – aber das Navi spinnt",
  "Dad versucht, einen TikTok-Dance zu lernen – die Kinder sind entsetzt",
  "Historische Persönlichkeiten treffen sich beim Supermarkt und streiten über Selbstbedienung",
  "Der Hund hat das Mittagessen gestohlen – Familienrat wird einberufen",
];

export default function StoryGenerator() {
  const [, navigate] = useLocation();
  const [theme, setTheme] = useState("");
  const [selectedAssetIds, setSelectedAssetIds] = useState<number[]>([]);
  const [model, setModel] = useState<"claude-sonnet-4-5" | "claude-opus-4-5">("claude-sonnet-4-5");
  const [imageFormat, setImageFormat] = useState<"1:1" | "4:5">("1:1");
  const [imageProvider, setImageProvider] = useState<"gpt-image-2" | "freepik">("gpt-image-2");
  const [assetPickerOpen, setAssetPickerOpen] = useState(false);
  const [assetCategory, setAssetCategory] = useState("all");

  const { data: assets = [] } = trpc.assets.list.useQuery({ category: assetCategory === "all" ? undefined : assetCategory });

  const createStory = trpc.stories.create.useMutation({
    onSuccess: (data) => {
      toast.success(`Story "${data.title}" erstellt!`);
      navigate(`/story/${data.storyId}`);
    },
    onError: (err) => toast.error(`Fehler: ${err.message}`),
  });

  const toggleAsset = (id: number) => {
    setSelectedAssetIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const selectedAssets = assets.filter((a) => selectedAssetIds.includes(a.id));

  const handleGenerate = () => {
    if (!theme.trim()) {
      toast.error("Bitte gib ein Thema ein");
      return;
    }
    createStory.mutate({ theme, selectedAssetIds, model, imageFormat, imageProvider });
  };

  return (
    <AppLayout>
      <div className="p-6 lg:p-8 max-w-3xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground">Story Generator</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Gib ein Thema vor – Claude erstellt eine in sich geschlossene 10-Slide Geschichte
          </p>
        </div>

        {/* Theme Input */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <CardTitle className="font-display text-base flex items-center gap-2">
              <SparklesIcon className="w-4 h-4 text-primary" />
              Story-Thema
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea
              placeholder="Beschreibe deine Story-Idee... z.B. 'Die Familie Mitchell macht einen chaotischen Roadtrip nach Hamburg'"
              value={theme}
              onChange={(e) => setTheme(e.target.value)}
              className="bg-background border-border resize-none text-base"
              rows={4}
            />
            <div className="flex flex-wrap gap-2">
              <span className="text-xs text-muted-foreground">Beispiele:</span>
              {EXAMPLE_THEMES.map((ex) => (
                <button
                  key={ex}
                  onClick={() => setTheme(ex)}
                  className="text-xs text-primary hover:underline"
                >
                  "{ex.slice(0, 40)}..."
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Settings */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <CardTitle className="font-display text-base">Einstellungen</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">KI-Modell</Label>
              <Select value={model} onValueChange={(v) => setModel(v as typeof model)}>
                <SelectTrigger className="bg-background border-border">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="claude-sonnet-4-5">Claude Sonnet (schnell)</SelectItem>
                  <SelectItem value="claude-opus-4-5">Claude Opus (kreativ)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Bildformat</Label>
              <Select value={imageFormat} onValueChange={(v) => setImageFormat(v as typeof imageFormat)}>
                <SelectTrigger className="bg-background border-border">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1:1">1:1 Quadrat (1080×1080)</SelectItem>
                  <SelectItem value="4:5">4:5 Hochformat (1080×1350)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Bild-API</Label>
              <Select value={imageProvider} onValueChange={(v) => setImageProvider(v as typeof imageProvider)}>
                <SelectTrigger className="bg-background border-border">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="gpt-image-2">gpt-image-2 (OpenAI)</SelectItem>
                  <SelectItem value="freepik">Freepik API</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Asset Selection */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="font-display text-base flex items-center gap-2">
                <ImageIcon className="w-4 h-4 text-primary" />
                Charaktere & Assets auswählen
                {selectedAssetIds.length > 0 && (
                  <Badge className="text-xs">{selectedAssetIds.length} ausgewählt</Badge>
                )}
              </CardTitle>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setAssetPickerOpen(!assetPickerOpen)}
                className="gap-1 text-xs"
              >
                {assetPickerOpen ? <ChevronUpIcon className="w-3.5 h-3.5" /> : <ChevronDownIcon className="w-3.5 h-3.5" />}
                {assetPickerOpen ? "Schließen" : "Öffnen"}
              </Button>
            </div>
          </CardHeader>

          {/* Selected preview */}
          {selectedAssets.length > 0 && (
            <div className="px-6 pb-3 flex flex-wrap gap-2">
              {selectedAssets.map((a) => (
                <div key={a.id} className="flex items-center gap-1.5 bg-primary/10 border border-primary/20 rounded-full px-2 py-1">
                  <img src={a.imageUrl} alt={a.name} className="w-5 h-5 rounded-full object-cover" />
                  <span className="text-xs text-primary font-medium">{a.name}</span>
                  <button onClick={() => toggleAsset(a.id)}>
                    <XIcon className="w-3 h-3 text-primary/60 hover:text-primary" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {assetPickerOpen && (
            <CardContent className="pt-0 space-y-3">
              {/* Category filter */}
              <div className="flex flex-wrap gap-1.5">
                {["all", ...Object.keys(CATEGORY_LABELS)].map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setAssetCategory(cat)}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                      assetCategory === cat
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {cat === "all" ? "Alle" : CATEGORY_LABELS[cat]}
                  </button>
                ))}
              </div>

              {/* Asset grid */}
              {assets.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  Keine Assets in dieser Kategorie. <a href="/library" className="text-primary underline">Assets hochladen</a>
                </p>
              ) : (
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 max-h-64 overflow-y-auto">
                  {assets.map((asset) => {
                    const isSelected = selectedAssetIds.includes(asset.id);
                    return (
                      <button
                        key={asset.id}
                        onClick={() => toggleAsset(asset.id)}
                        className={`relative rounded-lg overflow-hidden border-2 transition-all ${
                          isSelected ? "border-primary" : "border-transparent hover:border-border"
                        }`}
                      >
                        <div className="aspect-square bg-muted">
                          <img src={asset.imageUrl} alt={asset.name} className="w-full h-full object-cover" loading="lazy" />
                        </div>
                        {isSelected && (
                          <div className="absolute top-1 right-1 w-5 h-5 bg-primary rounded-full flex items-center justify-center">
                            <CheckIcon className="w-3 h-3 text-primary-foreground" />
                          </div>
                        )}
                        <p className="text-xs text-center py-1 px-1 truncate text-foreground">{asset.name}</p>
                      </button>
                    );
                  })}
                </div>
              )}
            </CardContent>
          )}
        </Card>

        {/* Generate Button */}
        <div className="flex flex-col gap-3">
          <Button
            size="lg"
            className="w-full gap-2 font-semibold text-base h-12"
            onClick={handleGenerate}
            disabled={!theme.trim() || createStory.isPending}
          >
            {createStory.isPending ? (
              <>
                <span className="animate-spin text-lg">⟳</span>
                Claude generiert Story...
              </>
            ) : (
              <>
                <SparklesIcon className="w-5 h-5" />
                Story generieren
              </>
            )}
          </Button>
          {createStory.isPending && (
            <p className="text-xs text-muted-foreground text-center animate-pulse">
              Claude analysiert dein Thema und erstellt 10 konsistente Slides... (ca. 15–30 Sekunden)
            </p>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
