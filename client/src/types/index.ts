// Mirrors scripts/import-klarekante-style.ts FOLDER_HINTS — strong priors
// for vision categorization when the user is uploading a known persona batch.
export type AssetCategoryKey =
  | "familie" | "historisch" | "sport" | "musik" | "politiker" | "tech-ceo"
  | "tiere" | "umgebungen" | "fahrzeuge" | "items" | "stil-referenz" | "sonstiges";

export type FolderHint = {
  characterName?: string;
  characterKind?: "family" | "public_figure" | "fictional" | "world-built";
  characterAliases?: string[];
  fallbackCategory?: AssetCategoryKey;
};

/**
 * Message type matching server-side LLM Message interface
 */
export type Message = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type AIChatBoxProps = {
  /**
   * Messages array to display in the chat.
   * Should match the format used by invokeLLM on the server.
   */
  messages: Message[];

  /**
   * Callback when user sends a message.
   * Typically you'll call a tRPC mutation here to invoke the LLM.
   */
  onSendMessage: (content: string) => void;

  /**
   * Whether the AI is currently generating a response
   */
  isLoading?: boolean;

  /**
   * Placeholder text for the input field
   */
  placeholder?: string;

  /**
   * Custom className for the container
   */
  className?: string;

  /**
   * Height of the chat box (default: 600px)
   */
  height?: string | number;

  /**
   * Empty state message to display when no messages
   */
  emptyStateMessage?: string;

  /**
   * Suggested prompts to display in empty state
   * Click to send directly
   */
  suggestedPrompts?: string[];
};
