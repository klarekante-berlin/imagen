import { useState } from "react";
import { useLocation } from "wouter";
import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  SearchIcon,
  PlusIcon,
  TrashIcon,
  ArrowRightIcon,
  CopyIcon,
  ArchiveIcon,
  SparklesIcon,
  ImageIcon,
  CheckCircleIcon,
  AlertCircleIcon,
  LoaderIcon,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

const STATUS_CONFIG = {
  complete: { label: "Fertig", color: "bg-green-500/20 text-green-400", icon: CheckCircleIcon },
  error: { label: "Fehler", color: "bg-red-500/20 text-red-400", icon: AlertCircleIcon },
  generating_images: { label: "Bilder generieren...", color: "bg-yellow-500/20 text-yellow-400", icon: LoaderIcon },
  generating_text: { label: "Text generieren...", color: "bg-blue-500/20 text-blue-400", icon: LoaderIcon },
  draft: { label: "Entwurf", color: "bg-muted text-muted-foreground", icon: ImageIcon },
};

export default function Archive() {
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const utils = trpc.useUtils();
  const { data: stories = [], isLoading } = trpc.stories.list.useQuery();

  const deleteMutation = trpc.stories.delete.useMutation({
    onSuccess: () => {
      toast.success("Story gelöscht");
      utils.stories.list.invalidate();
      setDeleteId(null);
    },
    onError: (err) => toast.error(`Fehler: ${err.message}`),
  });

  const duplicateMutation = trpc.stories.duplicate.useMutation({
    onSuccess: (data) => {
      toast.success("Story dupliziert!");
      utils.stories.list.invalidate();
      navigate(`/story/${data.storyId}`);
    },
    onError: (err) => toast.error(`Fehler: ${err.message}`),
  });

  const filtered = stories.filter(
    (s) =>
      !search ||
      s.title.toLowerCase().includes(search.toLowerCase()) ||
      s.theme.toLowerCase().includes(search.toLowerCase())
  );

  const formatDate = (date: Date | string) =>
    new Date(date).toLocaleDateString("de-DE", { day: "2-digit", month: "short", year: "numeric" });

  return (
    <AppLayout>
      <div className="p-6 lg:p-8 space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-bold text-foreground">Story Archiv</h1>
            <p className="text-muted-foreground text-sm mt-1">{stories.length} Stories gespeichert</p>
          </div>
          <Button onClick={() => navigate("/generator")} className="gap-2 self-start">
            <PlusIcon className="w-4 h-4" />
            Neue Story
          </Button>
        </div>

        {/* Search */}
        <div className="relative max-w-sm">
          <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Stories suchen..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 bg-card border-border"
          />
        </div>

        {/* Stories */}
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-24 rounded-xl bg-card animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <ArchiveIcon className="w-12 h-12 text-muted-foreground/30 mb-4" />
            <p className="text-muted-foreground font-medium">
              {search ? "Keine Stories gefunden" : "Noch keine Stories erstellt"}
            </p>
            {!search && (
              <Button className="mt-4 gap-2" onClick={() => navigate("/generator")}>
                <SparklesIcon className="w-4 h-4" />
                Erste Story erstellen
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((story) => {
              const statusCfg = STATUS_CONFIG[story.status as keyof typeof STATUS_CONFIG] || STATUS_CONFIG.draft;
              const StatusIcon = statusCfg.icon;
              return (
                <Card
                  key={story.id}
                  className="bg-card border-border hover:border-primary/30 transition-all group"
                >
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-display font-semibold text-foreground">{story.title}</h3>
                          <Badge className={`${statusCfg.color} text-xs gap-1`}>
                            <StatusIcon className={`w-3 h-3 ${story.status?.includes("generating") ? "animate-spin" : ""}`} />
                            {statusCfg.label}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground mt-1 line-clamp-1">{story.theme}</p>
                        <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                          <span>{formatDate(story.createdAt)}</span>
                          <span>·</span>
                          <span>{story.imageFormat}</span>
                          <span>·</span>
                          <span>{story.imageProvider}</span>
                          <span>·</span>
                          <span>{story.model === "claude-opus-4-5" ? "Opus" : "Sonnet"}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={() => duplicateMutation.mutate({ id: story.id })}
                          title="Duplizieren"
                        >
                          <CopyIcon className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={() => setDeleteId(story.id)}
                          title="Löschen"
                        >
                          <TrashIcon className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1.5 text-xs ml-1"
                          onClick={() => navigate(`/story/${story.id}`)}
                        >
                          Öffnen
                          <ArrowRightIcon className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Delete confirm */}
      <Dialog open={deleteId !== null} onOpenChange={() => setDeleteId(null)}>
        <DialogContent className="max-w-sm bg-card border-border">
          <DialogHeader>
            <DialogTitle className="font-display">Story löschen?</DialogTitle>
            <DialogDescription>Alle Slides und generierten Bilder werden unwiderruflich gelöscht.</DialogDescription>
          </DialogHeader>
          <div className="flex gap-3 pt-2">
            <Button variant="outline" className="flex-1" onClick={() => setDeleteId(null)}>Abbrechen</Button>
            <Button
              variant="destructive"
              className="flex-1"
              onClick={() => deleteId !== null && deleteMutation.mutate({ id: deleteId })}
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
