export const TELEFONO_DISPLAY = '393-4789383';
export const TELEFONO_TEL = 'tel:+393934789383';
const WHATSAPP_BASE = 'https://wa.me/393934789383';

export function linkWhatsApp(messaggio?: string): string {
  if (!messaggio) return WHATSAPP_BASE;
  return `${WHATSAPP_BASE}?text=${encodeURIComponent(messaggio)}`;
}
