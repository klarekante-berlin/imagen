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
  sonstiges: "Sonstiges",
};

const CATEGORIES = Object.keys(CATEGORY_LABELS);

export default function Library() {
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [previewAsset, setPreviewAsset] = useState<Asset | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);

  // Upload state
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadPreview, setUploadPreview] = useState<string | null>(null);
  const [uploadName, setUploadName] = useState("");
  const [uploadCategory, setUploadCategory] = useState<string>("sonstiges");
  const [uploadDescription, setUploadDescription] = useState("");
  const [uploadVisualDesc, setUploadVisualDesc] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const utils = trpc.useUtils();
  const { data: assets = [], isLoading } = trpc.assets.list.useQuery({ category: selectedCategory === "all" ? undefined : selectedCategory });

  const uploadMutation = trpc.assets.upload.useMutation({
    onSuccess: () => {
      toast.success("Asset erfolgreich hochgeladen!");
      utils.assets.list.invalidate();
      setUploadOpen(false);
      resetUpload();
    },
    onError: (err) => toast.error(`Upload fehlgeschlagen: ${err.message}`),
  });

  const deleteMutation = trpc.assets.delete.useMutation({
    onSuccess: () => {
      toast.success("Asset gelöscht");
      utils.assets.list.invalidate();
      setDeleteConfirm(null);
    },
    onError: (err) => toast.error(`Fehler: ${err.message}`),
  });

  const resetUpload = () => {
    setUploadFile(null);
    setUploadPreview(null);
    setUploadName("");
    setUploadCategory("sonstiges");
    setUploadDescription("");
    setUploadVisualDesc("");
  };

  const handleFileSelect = (file: File) => {
    setUploadFile(file);
    const reader = new FileReader();
    reader.onload = (e) => setUploadPreview(e.target?.result as string);
    reader.readAsDataURL(file);
    if (!uploadName) setUploadName(file.name.replace(/\.[^/.]+$/, ""));
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("image/")) handleFileSelect(file);
  }, []);

  const handleUploadSubmit = async () => {
    if (!uploadFile || !uploadName || !uploadCategory) {
      toast.error("Bitte Name, Kategorie und Bild ausfüllen");
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const base64 = (e.target?.result as string).split(",")[1];
      uploadMutation.mutate({
        name: uploadName,
        category: uploadCategory as Asset["category"],
        description: uploadDescription,
        visualDescription: uploadVisualDesc,
        imageData: base64,
        mimeType: uploadFile.type,
        fileName: uploadFile.name,
      });
    };
    reader.readAsDataURL(uploadFile);
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
        </div>

        {/* Category tabs */}
        <div className="flex flex-wrap gap-2">
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
                  <Badge variant="secondary" className="text-xs mt-1">
                    {CATEGORY_LABELS[asset.category] || asset.category}
                  </Badge>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Upload Dialog */}
      <Dialog open={uploadOpen} onOpenChange={(o) => { setUploadOpen(o); if (!o) resetUpload(); }}>
        <DialogContent className="max-w-lg bg-card border-border">
          <DialogHeader>
            <DialogTitle className="font-display">Asset hochladen</DialogTitle>
            <DialogDescription>Character Sheet, Umgebung oder Item zur Library hinzufügen</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
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
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileSelect(f); }}
              />
              {uploadPreview ? (
                <div className="relative">
                  <img src={uploadPreview} alt="Preview" className="max-h-40 mx-auto rounded-lg object-contain" />
                  <button
                    className="absolute top-0 right-0 bg-destructive text-white rounded-full p-0.5"
                    onClick={(e) => { e.stopPropagation(); setUploadFile(null); setUploadPreview(null); }}
                  >
                    <XIcon className="w-3 h-3" />
                  </button>
                </div>
              ) : (
                <>
                  <UploadIcon className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">Bild hierher ziehen oder <span className="text-primary">klicken</span></p>
                  <p className="text-xs text-muted-foreground/60 mt-1">PNG, JPG, WEBP bis 10MB</p>
                </>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="asset-name">Name *</Label>
                <Input
                  id="asset-name"
                  placeholder="z.B. Dad Character Sheet"
                  value={uploadName}
                  onChange={(e) => setUploadName(e.target.value)}
                  className="bg-background border-border"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="asset-category">Kategorie *</Label>
                <Select value={uploadCategory} onValueChange={setUploadCategory}>
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
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="asset-desc">Beschreibung</Label>
              <Input
                id="asset-desc"
                placeholder="Kurze Beschreibung des Assets"
                value={uploadDescription}
                onChange={(e) => setUploadDescription(e.target.value)}
                className="bg-background border-border"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="asset-visual">Visuelle Beschreibung (für KI-Prompts)</Label>
              <Textarea
                id="asset-visual"
                placeholder="z.B. 'Tall man in his 40s, brown hair, wearing blue jeans and white t-shirt, friendly expression'"
                value={uploadVisualDesc}
                onChange={(e) => setUploadVisualDesc(e.target.value)}
                className="bg-background border-border resize-none"
                rows={3}
              />
              <p className="text-xs text-muted-foreground">Diese Beschreibung wird in die Bildprompts eingefügt für maximale Konsistenz.</p>
            </div>

            <div className="flex gap-3 pt-2">
              <Button variant="outline" className="flex-1" onClick={() => { setUploadOpen(false); resetUpload(); }}>
                Abbrechen
              </Button>
              <Button
                className="flex-1 gap-2"
                onClick={handleUploadSubmit}
                disabled={!uploadFile || !uploadName || uploadMutation.isPending}
              >
                {uploadMutation.isPending ? (
                  <><span className="animate-spin">⟳</span> Hochladen...</>
                ) : (
                  <><UploadIcon className="w-4 h-4" /> Hochladen</>
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
