/** Best-effort label for which kind of device logged an event: Phone, Tablet or Laptop. */
export function detectDeviceLabel(): string {
  if (typeof navigator === 'undefined') return 'Device';
  const ua = navigator.userAgent;
  if (/iPad|Tablet|PlayBook|Silk/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) {
    return 'Tablet';
  }
  if (/Mobi|iPhone|iPod|Android/i.test(ua)) return 'Phone';
  return 'Laptop';
}
