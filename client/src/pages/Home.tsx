import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { Link } from "wouter";
import { PlusIcon, ArrowRightIcon, ImageIcon, BookOpenIcon, AlertTriangleIcon } from "lucide-react";
import { STATUS_CONFIG } from "@/const";

const RELATIVE_TIME = new Intl.RelativeTimeFormat("de-DE", { numeric: "auto" });

function relativeTime(date: Date | string): string {
  const ms = new Date(date).getTime() - Date.now();
  const sec = Math.round(ms / 1000);
  const abs = Math.abs(sec);
  if (abs < 60) return RELATIVE_TIME.format(sec, "second");
  if (abs < 3600) return RELATIVE_TIME.format(Math.round(sec / 60), "minute");
  if (abs < 86400) return RELATIVE_TIME.format(Math.round(sec / 3600), "hour");
  return RELATIVE_TIME.format(Math.round(sec / 86400), "day");
}

function getSlideCount(consistencyContext: unknown): number | null {
  if (typeof consistencyContext !== "object" || consistencyContext === null) return null;
  const ctx = consistencyContext as { slideCount?: unknown };
  return typeof ctx.slideCount === "number" ? ctx.slideCount : null;
}

export default function Home() {
  const { data: stories = [] } = trpc.stories.list.useQuery();
  const { data: assets = [] } = trpc.assets.list.useQuery({});

  const recentStories = [...stories]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5);

  const needsReviewCount = assets.filter((a) => a.reviewStatus === "needs_review").length;
  const recentAssets = [...assets]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 4);

  return (
    <AppLayout>
      <div className="p-6 lg:p-8 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <h1 className="font-display text-2xl font-bold text-foreground">Imagen</h1>
          <Link href="/generator">
            <Button className="gap-2">
              <PlusIcon className="w-4 h-4" />
              Neue Story
            </Button>
          </Link>
        </div>

        {/* Two-column dashboard */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Recent stories */}
          <Card className="bg-card border-border">
            <CardContent className="p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-lg font-semibold text-foreground">Zuletzt</h2>
                <span className="text-xs text-muted-foreground">{stories.length} gesamt</span>
              </div>

              {recentStories.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <BookOpenIcon className="w-8 h-8 text-muted-foreground/30 mb-3" />
                  <p className="text-sm text-muted-foreground mb-3">Noch keine Stories.</p>
                  <Link href="/generator">
                    <Button size="sm" className="gap-2">
                      <PlusIcon className="w-3.5 h-3.5" />
                      Neue Story
                    </Button>
                  </Link>
                </div>
              ) : (
                <ul className="space-y-1.5">
                  {recentStories.map((story) => {
                    const cfg = STATUS_CONFIG[story.status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.draft;
                    const StatusIcon = cfg.icon;
                    const slideCount = getSlideCount(story.consistencyContext);
                    return (
                      <li key={story.id}>
                        <Link href={`/story/${story.id}`}>
                          <div className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/40 transition-colors cursor-pointer">
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-foreground truncate">{story.title}</p>
                              <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                                {slideCount !== null && <span>{slideCount} Slides</span>}
                                {slideCount !== null && <span>·</span>}
                                <span>{relativeTime(story.createdAt)}</span>
                              </div>
                            </div>
                            <Badge className={`${cfg.color} text-xs gap-1 shrink-0`}>
                              <StatusIcon
                                className={`w-3 h-3 ${story.status?.includes("generating") ? "animate-spin" : ""}`}
                              />
                              {cfg.label}
                            </Badge>
                          </div>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}

              <div className="pt-2 border-t border-border/50">
                <Link href="/archive">
                  <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground w-full justify-start">
                    Archiv öffnen <ArrowRightIcon className="w-3.5 h-3.5" />
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>

          {/* Library at-a-glance */}
          <Card className="bg-card border-border">
            <CardContent className="p-5 space-y-4">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <h2 className="font-display text-lg font-semibold text-foreground">Library</h2>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{assets.length} Assets</span>
                  {needsReviewCount > 0 && (
                    <>
                      <span>·</span>
                      <Link href="/library">
                        <span className="text-amber-400 hover:underline cursor-pointer inline-flex items-center gap-1">
                          <AlertTriangleIcon className="w-3 h-3" />
                          {needsReviewCount} ungeprüft
                        </span>
                      </Link>
                    </>
                  )}
                </div>
              </div>

              {recentAssets.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <ImageIcon className="w-8 h-8 text-muted-foreground/30 mb-3" />
                  <p className="text-sm text-muted-foreground mb-3">Library leer.</p>
                  <Link href="/library">
                    <Button size="sm" variant="outline" className="gap-2">
                      <ImageIcon className="w-3.5 h-3.5" />
                      Library öffnen
                    </Button>
                  </Link>
                </div>
              ) : (
                <div className="grid grid-cols-4 gap-2">
                  {recentAssets.map((asset) => (
                    <Link key={asset.id} href="/library">
                      <div className="aspect-square rounded-lg overflow-hidden bg-muted border border-border hover:border-primary/40 transition-colors cursor-pointer">
                        <img
                          src={asset.imageUrl}
                          alt={asset.name}
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                      </div>
                    </Link>
                  ))}
                </div>
              )}

              <div className="pt-2 border-t border-border/50">
                <Link href="/library">
                  <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground w-full justify-start">
                    Library öffnen <ArrowRightIcon className="w-3.5 h-3.5" />
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </AppLayout>
  );
}
