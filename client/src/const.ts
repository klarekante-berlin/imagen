import {
  CheckCircleIcon,
  AlertCircleIcon,
  LoaderIcon,
  ImageIcon,
} from "lucide-react";

export const CATEGORY_LABELS: Record<string, string> = {
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

export const STATUS_CONFIG = {
  complete: { label: "Fertig", color: "bg-green-500/20 text-green-400", icon: CheckCircleIcon },
  error: { label: "Fehler", color: "bg-red-500/20 text-red-400", icon: AlertCircleIcon },
  generating: { label: "Generiert...", color: "bg-yellow-500/20 text-yellow-400", icon: LoaderIcon },
  pending: { label: "Ausstehend", color: "bg-muted text-muted-foreground", icon: ImageIcon },
  draft: { label: "Entwurf", color: "bg-muted text-muted-foreground", icon: ImageIcon },
  generating_text: { label: "Text wird generiert...", color: "bg-blue-500/20 text-blue-400", icon: LoaderIcon },
  generating_images: { label: "Bilder werden generiert...", color: "bg-yellow-500/20 text-yellow-400", icon: LoaderIcon },
};
