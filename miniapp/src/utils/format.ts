import dayjs from 'dayjs';

export function formatDate(ts: number): string {
  return dayjs(ts).format('MM-DD HH:mm');
}
