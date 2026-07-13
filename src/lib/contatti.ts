export const TELEFONO_DISPLAY = '328-611-9960';
export const TELEFONO_TEL = 'tel:+393286119960';
const WHATSAPP_BASE = 'https://wa.me/393286119960';

export function linkWhatsApp(messaggio?: string): string {
  if (!messaggio) return WHATSAPP_BASE;
  return `${WHATSAPP_BASE}?text=${encodeURIComponent(messaggio)}`;
}
