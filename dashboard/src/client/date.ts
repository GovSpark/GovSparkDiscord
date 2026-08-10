export function formatJst(value: string): string {
  if (!value) return '未設定';
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(value));
}

export function toJstInput(value: string): string {
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(value));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

export function jstInputToIso(value: string): string {
  const normalized = value.length === 16 ? `${value}:00` : value;
  const date = new Date(`${normalized}+09:00`);
  if (Number.isNaN(date.getTime())) throw new Error('期限の形式が正しくありません。');
  return date.toISOString();
}
