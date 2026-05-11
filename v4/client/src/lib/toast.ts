import { toast as sonner } from "sonner";

export const toast = {
  success: (msg: string, description?: string) =>
    sonner.success(msg, { description }),
  error: (msg: string, description?: string) =>
    sonner.error(msg, { description }),
  info: (msg: string, description?: string) =>
    sonner.info(msg, { description }),
  /** For confirming user actions or unobtrusive notes. */
  note: (msg: string) => sonner(msg),
};
