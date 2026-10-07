/**
 * Links that open a WhatsApp chat with a message already written.
 *
 * The shop runs on WhatsApp, so after a decision the quickest way to tell the
 * buyer is a chat that opens ready to send, not a notification system. The
 * person still reads it and presses send; nothing goes out on its own.
 */

/** A wa.me link to a canonical 2547XXXXXXXX number, with `text` pre-filled. */
export function whatsAppLink(phone: string, text: string): string {
  return `https://wa.me/${phone.replace(/\D/g, "")}?text=${encodeURIComponent(text)}`;
}

/**
 * A wa.me link with no number: WhatsApp asks who to send it to, so the owner
 * can post it to a customer, a group or their Status.
 */
export function whatsAppShareLink(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

/** "Grace Wanjiku" → "Grace". Somebody who gave no usable name gets "Hi there". */
export function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] || "there";
}
