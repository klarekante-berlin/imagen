import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { Link } from "wouter";
import { SparklesIcon, ImageIcon, BookOpenIcon, ArchiveIcon, ArrowRightIcon, ZapIcon } from "lucide-react";

export default function Home() {
  const { data: stories } = trpc.stories.list.useQuery();
  const { data: assets } = trpc.assets.list.useQuery({});

  const recentStories = stories?.slice(0, 3) || [];
  const totalAssets = assets?.length || 0;
  const totalStories = stories?.length || 0;
  const completedStories = stories?.filter((s) => s.status === "complete").length || 0;

  return (
    <AppLayout>
      <div className="p-6 lg:p-8 space-y-8">
        {/* Hero */}
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary/20 via-card to-accent/10 border border-border p-8">
          <div className="relative z-10">
            <div className="flex items-center gap-2 text-primary text-sm font-medium mb-3">
              <ZapIcon className="w-4 h-4" />
              KI-gestützte Story-Generierung
            </div>
            <h1 className="font-display text-3xl lg:text-4xl font-bold text-foreground mb-3">
              Willkommen bei{" "}
              <span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                Imagen
              </span>
            </h1>
            <p className="text-muted-foreground text-lg max-w-xl mb-6">
              Erstelle konsistente Instagram Carousel Stories mit KI – von der Idee bis zum fertigen 10-Slide Export.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link href="/generator">
                <Button size="lg" className="gap-2 font-semibold">
                  <SparklesIcon className="w-4 h-4" />
                  Story erstellen
                </Button>
              </Link>
              <Link href="/library">
                <Button size="lg" variant="outline" className="gap-2">
                  <ImageIcon className="w-4 h-4" />
                  Asset Library
                </Button>
              </Link>
            </div>
          </div>
          {/* Decorative circles */}
          <div className="absolute -right-16 -top-16 w-64 h-64 rounded-full bg-primary/5 blur-3xl" />
          <div className="absolute -right-8 -bottom-8 w-48 h-48 rounded-full bg-accent/5 blur-2xl" />
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: "Assets in Library", value: totalAssets, icon: ImageIcon, color: "text-blue-400" },
            { label: "Stories gesamt", value: totalStories, icon: BookOpenIcon, color: "text-purple-400" },
            { label: "Fertige Stories", value: completedStories, icon: SparklesIcon, color: "text-green-400" },
            { label: "Slides generiert", value: completedStories * 10, icon: ArchiveIcon, color: "text-orange-400" },
          ].map(({ label, value, icon: Icon, color }) => (
            <Card key={label} className="bg-card border-border">
              <CardContent className="p-5">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-muted-foreground text-sm">{label}</span>
                  <Icon className={`w-4 h-4 ${color}`} />
                </div>
                <p className="font-display text-2xl font-bold text-foreground">{value}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Quick actions */}
        <div>
          <h2 className="font-display text-xl font-semibold text-foreground mb-4">Schnellzugriff</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              {
                href: "/generator",
                title: "Neue Story",
                desc: "Thema eingeben → Claude generiert 10 Slides",
                icon: SparklesIcon,
                gradient: "from-primary/20 to-primary/5",
              },
              {
                href: "/library",
                title: "Assets verwalten",
                desc: "Character Sheets hochladen und kategorisieren",
                icon: ImageIcon,
                gradient: "from-blue-500/20 to-blue-500/5",
              },
              {
                href: "/archive",
                title: "Story Archiv",
                desc: "Alle generierten Stories abrufen und exportieren",
                icon: ArchiveIcon,
                gradient: "from-accent/20 to-accent/5",
              },
            ].map(({ href, title, desc, icon: Icon, gradient }) => (
              <Link key={href} href={href}>
                <Card className={`bg-gradient-to-br ${gradient} border-border hover:border-primary/50 transition-all cursor-pointer group`}>
                  <CardContent className="p-5">
                    <Icon className="w-6 h-6 text-primary mb-3" />
                    <h3 className="font-display font-semibold text-foreground mb-1">{title}</h3>
                    <p className="text-sm text-muted-foreground">{desc}</p>
                    <div className="flex items-center gap-1 text-primary text-sm font-medium mt-3 group-hover:gap-2 transition-all">
                      Öffnen <ArrowRightIcon className="w-3.5 h-3.5" />
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </div>

        {/* Recent stories */}
        {recentStories.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-display text-xl font-semibold text-foreground">Zuletzt erstellt</h2>
              <Link href="/archive">
                <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground">
                  Alle anzeigen <ArrowRightIcon className="w-3.5 h-3.5" />
                </Button>
              </Link>
            </div>
            <div className="space-y-3">
              {recentStories.map((story) => (
                <Link key={story.id} href={`/story/${story.id}`}>
                  <Card className="bg-card border-border hover:border-primary/30 transition-all cursor-pointer">
                    <CardContent className="p-4 flex items-center justify-between">
                      <div>
                        <p className="font-medium text-foreground">{story.title}</p>
                        <p className="text-sm text-muted-foreground mt-0.5 line-clamp-1">{story.theme}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                          story.status === "complete" ? "bg-green-500/20 text-green-400" :
                          story.status === "generating_images" ? "bg-yellow-500/20 text-yellow-400" :
                          story.status === "error" ? "bg-red-500/20 text-red-400" :
                          "bg-muted text-muted-foreground"
                        }`}>
                          {story.status === "complete" ? "Fertig" :
                           story.status === "generating_images" ? "Generiert..." :
                           story.status === "draft" ? "Entwurf" : story.status}
                        </span>
                        <ArrowRightIcon className="w-4 h-4 text-muted-foreground" />
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
