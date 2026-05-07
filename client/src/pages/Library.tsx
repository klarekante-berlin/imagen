import { useState, useRef, useCallback } from "react";
import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  UploadIcon,
  SearchIcon,
  TrashIcon,
  EyeIcon,
  PlusIcon,
  ImageIcon,
  XIcon,
  PencilIcon,
  CheckCheckIcon,
  AlertTriangleIcon,
} from "lucide-react";
import type { Asset } from "../../../drizzle/schema";

const CATEGORY_LABELS: Record<string, string> = {
  all: "Alle",
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
  "stil-referenz": "Stil-Referenz",
  sonstiges: "Sonstiges",
};

const CATEGORIES = Object.keys(CATEGORY_LABELS);

// Mirrors scripts/import-klarekante-style.ts FOLDER_HINTS — strong priors
// for vision categorization when the user is uploading a known persona batch.
type AssetCategoryKey =
  | "familie" | "historisch" | "sport" | "musik" | "politiker" | "tech-ceo"
  | "tiere" | "umgebungen" | "fahrzeuge" | "items" | "stil-referenz" | "sonstiges";

type FolderHint = {
  characterName?: string;
  characterKind?: "family" | "public_figure" | "fictional" | "world-built";
  characterAliases?: string[];
  fallbackCategory?: AssetCategoryKey;
};

const UPLOAD_HINTS: Record<string, FolderHint & { label: string }> = {
  none: { label: "🪄 Auto (Vision entscheidet)" },
  papa: { label: "👨 Papa (Familie)", characterName: "Papa", characterKind: "family", characterAliases: ["Vater", "Dad", "mein Vater"], fallbackCategory: "familie" },
  mama: { label: "👩 Mama (Familie)", characterName: "Mama", characterKind: "family", characterAliases: ["Mutter", "Mom"], fallbackCategory: "familie" },
  sohn: { label: "👦 Sohn (Familie)", characterName: "Sohn", characterKind: "family", characterAliases: ["Junge", "mein Sohn"], fallbackCategory: "familie" },
  tochter: { label: "👧 Tochter (Familie)", characterName: "Tochter", characterKind: "family", characterAliases: ["Mädchen", "meine Tochter"], fallbackCategory: "familie" },
  hund: { label: "🐶 Hund / Mops", characterName: "Mops", characterKind: "fictional", characterAliases: ["Hund", "Pug"], fallbackCategory: "tiere" },
  katze: { label: "🐱 Katze", characterName: "Katze", characterKind: "fictional", characterAliases: ["Cat"], fallbackCategory: "tiere" },
  athletes: { label: "🏃 Athleten", fallbackCategory: "sport" },
  musicians: { label: "🎤 Musiker", fallbackCategory: "musik" },
  politiker: { label: "🏛️ Politiker", fallbackCategory: "politiker" },
  tech_people: { label: "💻 Tech-CEOs", fallbackCategory: "tech-ceo" },
  historic_persons: { label: "📜 Historische Personen", fallbackCategory: "historisch" },
  umgebungen: { label: "🏞️ Umgebungen", fallbackCategory: "umgebungen" },
  vehicles: { label: "🚗 Fahrzeuge", fallbackCategory: "fahrzeuge" },
  items: { label: "📦 Items", fallbackCategory: "items" },
  social_media_posts: { label: "📱 Social-Media-Stil-Refs", fallbackCategory: "stil-referenz" },
};

interface QueueItem {
  id: string;
  file: File;
  preview: string;
  status: "pending" | "processing" | "done" | "error" | "skipped";
  result?: {
    assetId: number;
    deduplicated: boolean;
    suggestedCategory?: string;
    confidence?: number | null;
    matchedCharacter?: string | null;
  };
  errorMessage?: string;
}

export default function Library() {
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [selectedCharacterId, setSelectedCharacterId] = useState<number | null>(null);
  const [reviewOnly, setReviewOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [previewAsset, setPreviewAsset] = useState<Asset | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [editAsset, setEditAsset] = useState<Asset | null>(null);

  // Multi-file upload state
  const [uploadQueue, setUploadQueue] = useState<QueueItem[]>([]);
  const [uploadHint, setUploadHint] = useState<string>("none");
  const [isUploading, setIsUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Edit dialog state
  const [editCategory, setEditCategory] = useState<string>("sonstiges");
  const [editCharacterId, setEditCharacterId] = useState<number | null>(null);
  const [editIsCharacterSheet, setEditIsCharacterSheet] = useState(false);

  const utils = trpc.useUtils();
  const { data: assets = [], isLoading } = trpc.assets.list.useQuery({
    category: selectedCategory === "all" ? undefined : selectedCategory,
    characterId: selectedCharacterId ?? undefined,
    reviewStatus: reviewOnly ? "needs_review" : undefined,
  });
  const { data: charactersList = [] } = trpc.characters.list.useQuery();

  const uploadMutation = trpc.assets.upload.useMutation();

  const deleteMutation = trpc.assets.delete.useMutation({
    onSuccess: () => {
      toast.success("Asset gelöscht");
      utils.assets.list.invalidate();
      setDeleteConfirm(null);
    },
    onError: (err) => toast.error(`Fehler: ${err.message}`),
  });

  const approveMutation = trpc.assets.approveCategory.useMutation({
    onSuccess: () => {
      toast.success("Asset aktualisiert");
      utils.assets.list.invalidate();
      setEditAsset(null);
    },
    onError: (err) => toast.error(`Fehler: ${err.message}`),
  });

  const bulkApproveMutation = trpc.assets.bulkApprove.useMutation({
    onSuccess: (res) => {
      toast.success(`${res.approved} Asset(s) genehmigt`);
      utils.assets.list.invalidate();
    },
    onError: (err) => toast.error(`Fehler: ${err.message}`),
  });

  const openEdit = (asset: Asset) => {
    setEditAsset(asset);
    setEditCategory(asset.category);
    setEditCharacterId(asset.characterId ?? null);
    setEditIsCharacterSheet(asset.isCharacterSheet);
  };

  const handleEditSave = () => {
    if (!editAsset) return;
    approveMutation.mutate({
      id: editAsset.id,
      category: editCategory as Asset["category"],
      characterId: editCharacterId,
      isCharacterSheet: editIsCharacterSheet,
    });
  };

  const pendingReviewCount = assets.filter((a) => a.reviewStatus === "needs_review").length;

  const resetUpload = () => {
    setUploadQueue([]);
    setUploadHint("none");
    setIsUploading(false);
  };

  const addFilesToQueue = (files: File[]) => {
    const items: QueueItem[] = [];
    for (const file of files) {
      if (!file.type.startsWith("image/")) continue;
      items.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        file,
        preview: "",
        status: "pending",
      });
    }
    // Read previews
    items.forEach((item) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const preview = e.target?.result as string;
        setUploadQueue((prev) =>
          prev.map((q) => (q.id === item.id ? { ...q, preview } : q)),
        );
      };
      reader.readAsDataURL(item.file);
    });
    setUploadQueue((prev) => [...prev, ...items]);
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    addFilesToQueue(Array.from(e.dataTransfer.files));
  }, []);

  const removeFromQueue = (id: string) =>
    setUploadQueue((prev) => prev.filter((q) => q.id !== id));

  const fileToBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve((reader.result as string).split(",")[1]);
      reader.onerror = () => reject(new Error("FileReader failed"));
      reader.readAsDataURL(file);
    });

  const processQueue = async () => {
    if (isUploading) return;
    const pending = uploadQueue.filter((q) => q.status === "pending");
    if (pending.length === 0) return;
    setIsUploading(true);
    const hint = uploadHint !== "none" ? UPLOAD_HINTS[uploadHint] : null;

    // Sequential — vision rate limits + clearer per-file feedback
    for (const item of pending) {
      setUploadQueue((prev) =>
        prev.map((q) => (q.id === item.id ? { ...q, status: "processing" } : q)),
      );
      try {
        const base64 = await fileToBase64(item.file);
        const result = await uploadMutation.mutateAsync({
          name: item.file.name.replace(/\.[^/.]+$/, ""),
          autoCategorize: true,
          imageData: base64,
          mimeType: item.file.type,
          fileName: item.file.name,
          hint:
            hint && (hint.fallbackCategory || hint.characterName)
              ? {
                  folderName: uploadHint,
                  characterName: hint.characterName,
                  characterKind: hint.characterKind,
                  characterAliases: hint.characterAliases,
                  fallbackCategory: hint.fallbackCategory,
                }
              : undefined,
        });
        const matchedCharacter =
          result.vision?.suggestedCharacter.matchType === "existing"
            ? charactersList.find(
                (c) =>
                  c.id ===
                  (result.vision!.suggestedCharacter as { characterId: number }).characterId,
              )?.name ?? null
            : result.vision?.suggestedCharacter.matchType === "new"
              ? (result.vision!.suggestedCharacter as { name: string }).name
              : null;

        setUploadQueue((prev) =>
          prev.map((q) =>
            q.id === item.id
              ? {
                  ...q,
                  status: result.deduplicated ? "skipped" : "done",
                  result: {
                    assetId: result.id,
                    deduplicated: result.deduplicated,
                    suggestedCategory: result.vision?.suggestedCategory,
                    confidence: result.vision?.categoryConfidence ?? null,
                    matchedCharacter,
                  },
                }
              : q,
          ),
        );
      } catch (err) {
        setUploadQueue((prev) =>
          prev.map((q) =>
            q.id === item.id
              ? {
                  ...q,
                  status: "error",
                  errorMessage: err instanceof Error ? err.message : "Unknown",
                }
              : q,
          ),
        );
      }
    }

    setIsUploading(false);
    utils.assets.list.invalidate();
    utils.characters.list.invalidate();
    const successCount = uploadQueue.filter((q) => q.status === "done").length;
    toast.success(`${pending.length} Datei(en) verarbeitet`);
    void successCount;
  };

  const filteredAssets = assets.filter((a) =>
    !searchQuery || a.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <AppLayout>
      <div className="p-6 lg:p-8 space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-bold text-foreground">Asset Library</h1>
            <p className="text-muted-foreground text-sm mt-1">{assets.length} Assets in {Object.keys(CATEGORY_LABELS).length - 1} Kategorien</p>
          </div>
          <Button onClick={() => setUploadOpen(true)} className="gap-2 self-start">
            <PlusIcon className="w-4 h-4" />
            Asset hochladen
          </Button>
        </div>

        {/* Search + Filter */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Assets suchen..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 bg-card border-border"
            />
          </div>
          <Select
            value={selectedCharacterId === null ? "any" : String(selectedCharacterId)}
            onValueChange={(v) => setSelectedCharacterId(v === "any" ? null : parseInt(v, 10))}
          >
            <SelectTrigger className="w-full sm:w-56 bg-card border-border">
              <SelectValue placeholder="Charakter wählen" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Alle Charaktere</SelectItem>
              {charactersList.map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant={reviewOnly ? "default" : "outline"}
            onClick={() => setReviewOnly(!reviewOnly)}
            className="gap-2"
          >
            <AlertTriangleIcon className="w-4 h-4" />
            Nur ungeprüfte
          </Button>
        </div>

        {/* Category tabs + bulk-approve */}
        <div className="flex flex-wrap gap-2 items-center">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                selectedCategory === cat
                  ? "bg-primary text-primary-foreground"
                  : "bg-card border border-border text-muted-foreground hover:text-foreground hover:border-primary/50"
              }`}
            >
              {CATEGORY_LABELS[cat]}
            </button>
          ))}
          {pendingReviewCount > 0 && (
            <Button
              size="sm"
              variant="secondary"
              className="ml-auto gap-2"
              onClick={() => bulkApproveMutation.mutate({ minConfidence: 80 })}
              disabled={bulkApproveMutation.isPending}
            >
              <CheckCheckIcon className="w-4 h-4" />
              {pendingReviewCount} ≥80% übernehmen
            </Button>
          )}
        </div>

        {/* Asset Grid */}
        {isLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="aspect-square rounded-xl bg-card animate-pulse" />
            ))}
          </div>
        ) : filteredAssets.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <ImageIcon className="w-12 h-12 text-muted-foreground/30 mb-4" />
            <p className="text-muted-foreground font-medium">Keine Assets gefunden</p>
            <p className="text-muted-foreground/60 text-sm mt-1">
              {searchQuery ? "Suchbegriff ändern oder" : "Lade dein erstes Asset hoch –"}{" "}
              <button onClick={() => setUploadOpen(true)} className="text-primary underline">
                Asset hochladen
              </button>
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {filteredAssets.map((asset) => (
              <Card
                key={asset.id}
                className="group bg-card border-border hover:border-primary/40 transition-all cursor-pointer overflow-hidden"
              >
                <div className="relative aspect-square bg-muted">
                  <img
                    src={asset.imageUrl}
                    alt={asset.name}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                  {asset.reviewStatus === "needs_review" && (
                    <Badge
                      variant="destructive"
                      className="absolute top-2 right-2 text-[10px] gap-1"
                    >
                      <AlertTriangleIcon className="w-3 h-3" />
                      Prüfen
                    </Badge>
                  )}
                  {/* Overlay actions */}
                  <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                    <Button
                      size="icon"
                      variant="secondary"
                      className="h-8 w-8"
                      onClick={() => setPreviewAsset(asset)}
                    >
                      <EyeIcon className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="secondary"
                      className="h-8 w-8"
                      onClick={() => openEdit(asset)}
                    >
                      <PencilIcon className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="destructive"
                      className="h-8 w-8"
                      onClick={() => setDeleteConfirm(asset.id)}
                    >
                      <TrashIcon className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
                <CardContent className="p-3">
                  <p className="text-sm font-medium text-foreground truncate">{asset.name}</p>
                  <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                    <Badge variant="secondary" className="text-xs">
                      {CATEGORY_LABELS[asset.category] || asset.category}
                    </Badge>
                    {asset.characterId && (
                      <Badge variant="outline" className="text-xs">
                        {charactersList.find((c) => c.id === asset.characterId)?.name ?? "?"}
                      </Badge>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Upload Dialog — multi-file with vision preview */}
      <Dialog open={uploadOpen} onOpenChange={(o) => { setUploadOpen(o); if (!o) resetUpload(); }}>
        <DialogContent className="max-w-2xl bg-card border-border max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display">Assets hochladen</DialogTitle>
            <DialogDescription>
              Mehrere Dateien gleichzeitig — Vision kategorisiert automatisch und matched
              an deine Charaktere. Optional kannst du oben einen Folder-Hint setzen für
              gebatchte Personen-Uploads.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {/* Hint preset */}
            <div className="space-y-1.5">
              <Label>Folder-Hint (optional, gilt für alle Files in diesem Batch)</Label>
              <Select value={uploadHint} onValueChange={setUploadHint}>
                <SelectTrigger className="bg-background border-border">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(UPLOAD_HINTS).map(([key, h]) => (
                    <SelectItem key={key} value={key}>{h.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Beispiel: alle "Sohn" Variations → wähle "Sohn (Familie)" → Vision matched
                gegen den Sohn-Character. Ohne Hint: pure Vision-Auto-Detect.
              </p>
            </div>

            {/* Drop zone */}
            <div
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`relative border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${
                isDragging ? "border-primary bg-primary/10" : "border-border hover:border-primary/50"
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  if (files.length > 0) addFilesToQueue(files);
                  e.target.value = ""; // allow re-selecting same files
                }}
              />
              <UploadIcon className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">
                Bilder hierher ziehen oder <span className="text-primary">klicken</span> (mehrere möglich)
              </p>
              <p className="text-xs text-muted-foreground/60 mt-1">PNG, JPG, WEBP. Sequentielle Verarbeitung.</p>
            </div>

            {/* Queue */}
            {uploadQueue.length > 0 && (
              <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                {uploadQueue.map((q) => (
                  <div
                    key={q.id}
                    className="flex items-center gap-3 p-2 rounded-lg border border-border/40 bg-background/30"
                  >
                    <div className="w-12 h-12 rounded-md overflow-hidden bg-muted/30 shrink-0">
                      {q.preview ? (
                        <img src={q.preview} alt={q.file.name} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <ImageIcon className="w-4 h-4 text-muted-foreground/30" />
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate">{q.file.name}</p>
                      <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                        {q.status === "pending" && (
                          <Badge variant="outline" className="text-[10px]">queued</Badge>
                        )}
                        {q.status === "processing" && (
                          <Badge className="text-[10px] gap-1 bg-primary/20 text-primary border-primary/30">
                            <span className="animate-spin">⟳</span> Vision…
                          </Badge>
                        )}
                        {q.status === "done" && q.result && (
                          <>
                            <Badge variant="secondary" className="text-[10px]">
                              {q.result.suggestedCategory ?? "?"}
                              {q.result.confidence != null ? ` ${q.result.confidence}%` : ""}
                            </Badge>
                            {q.result.matchedCharacter && (
                              <Badge className="text-[10px] bg-emerald-500/15 text-emerald-400 border-emerald-500/30">
                                {q.result.matchedCharacter}
                              </Badge>
                            )}
                          </>
                        )}
                        {q.status === "skipped" && (
                          <Badge variant="outline" className="text-[10px]">Duplikat (übersprungen)</Badge>
                        )}
                        {q.status === "error" && (
                          <Badge variant="destructive" className="text-[10px]">
                            Error: {q.errorMessage?.slice(0, 30)}
                          </Badge>
                        )}
                      </div>
                    </div>
                    {q.status === "pending" && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={() => removeFromQueue(q.id)}
                        title="Aus Queue entfernen"
                      >
                        <XIcon className="w-3.5 h-3.5" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => { setUploadOpen(false); resetUpload(); }}
                disabled={isUploading}
              >
                Schließen
              </Button>
              <Button
                className="flex-1 gap-2"
                onClick={processQueue}
                disabled={
                  isUploading ||
                  uploadQueue.filter((q) => q.status === "pending").length === 0
                }
              >
                {isUploading ? (
                  <><span className="animate-spin">⟳</span> Verarbeite…</>
                ) : (
                  <><UploadIcon className="w-4 h-4" /> {uploadQueue.filter((q) => q.status === "pending").length} hochladen</>
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Preview Dialog */}
      <Dialog open={!!previewAsset} onOpenChange={() => setPreviewAsset(null)}>
        <DialogContent className="max-w-2xl bg-card border-border">
          {previewAsset && (
            <>
              <DialogHeader>
                <DialogTitle className="font-display">{previewAsset.name}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <img
                  src={previewAsset.imageUrl}
                  alt={previewAsset.name}
                  className="w-full max-h-96 object-contain rounded-xl bg-muted"
                />
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Kategorie:</span>
                    <Badge variant="secondary" className="ml-2">{CATEGORY_LABELS[previewAsset.category]}</Badge>
                  </div>
                  {previewAsset.description && (
                    <div className="col-span-2">
                      <span className="text-muted-foreground">Beschreibung: </span>
                      <span className="text-foreground">{previewAsset.description}</span>
                    </div>
                  )}
                  {previewAsset.visualDescription && (
                    <div className="col-span-2">
                      <span className="text-muted-foreground block mb-1">Visuelle Beschreibung (KI-Prompt):</span>
                      <p className="text-foreground bg-muted rounded-lg p-3 text-xs font-mono">{previewAsset.visualDescription}</p>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Edit / Approve Dialog */}
      <Dialog open={!!editAsset} onOpenChange={(o) => !o && setEditAsset(null)}>
        <DialogContent className="max-w-md bg-card border-border">
          {editAsset && (
            <>
              <DialogHeader>
                <DialogTitle className="font-display">Asset prüfen & korrigieren</DialogTitle>
                <DialogDescription>{editAsset.name}</DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <img
                  src={editAsset.imageUrl}
                  alt={editAsset.name}
                  className="w-full max-h-48 object-contain rounded-lg bg-muted"
                />
                {editAsset.visionConfidence !== null && editAsset.visionConfidence !== undefined && (
                  <p className="text-xs text-muted-foreground">
                    Vision-Konfidenz: {editAsset.visionConfidence}%
                  </p>
                )}
                <div className="space-y-1.5">
                  <Label>Kategorie</Label>
                  <Select value={editCategory} onValueChange={setEditCategory}>
                    <SelectTrigger className="bg-background border-border">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.filter((c) => c !== "all").map((cat) => (
                        <SelectItem key={cat} value={cat}>{CATEGORY_LABELS[cat]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Charakter</Label>
                  <Select
                    value={editCharacterId === null ? "none" : String(editCharacterId)}
                    onValueChange={(v) => setEditCharacterId(v === "none" ? null : parseInt(v, 10))}
                  >
                    <SelectTrigger className="bg-background border-border">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Kein Charakter</SelectItem>
                      {charactersList.map((c) => (
                        <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={editIsCharacterSheet}
                    onChange={(e) => setEditIsCharacterSheet(e.target.checked)}
                  />
                  Ist Character-Sheet (saubere Reference)
                </label>
                <div className="flex gap-3 pt-2">
                  <Button variant="outline" className="flex-1" onClick={() => setEditAsset(null)}>
                    Abbrechen
                  </Button>
                  <Button
                    className="flex-1 gap-2"
                    onClick={handleEditSave}
                    disabled={approveMutation.isPending}
                  >
                    Speichern & approven
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <Dialog open={deleteConfirm !== null} onOpenChange={() => setDeleteConfirm(null)}>
        <DialogContent className="max-w-sm bg-card border-border">
          <DialogHeader>
            <DialogTitle className="font-display">Asset löschen?</DialogTitle>
            <DialogDescription>Diese Aktion kann nicht rückgängig gemacht werden.</DialogDescription>
          </DialogHeader>
          <div className="flex gap-3 pt-2">
            <Button variant="outline" className="flex-1" onClick={() => setDeleteConfirm(null)}>Abbrechen</Button>
            <Button
              variant="destructive"
              className="flex-1"
              onClick={() => deleteConfirm !== null && deleteMutation.mutate({ id: deleteConfirm })}
              disabled={deleteMutation.isPending}
            >
              Löschen
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
