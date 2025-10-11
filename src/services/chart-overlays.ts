import { Time } from 'lightweight-charts';
import { marketHoursService } from './market-hours';

export interface DaySeparator {
  startTime: number;
  endTime: number;
  dayOfWeek: number;
  isAlternate: boolean;
  color: string;
}

export interface WeekendOverlay {
  startTime: number;
  endTime: number;
  color: string;
}

class ChartOverlayService {
  private readonly DAY_COLOR_LIGHT = 'rgba(30, 41, 59, 0.3)';
  private readonly DAY_COLOR_DARK = 'rgba(15, 23, 42, 0.3)';
  private readonly WEEKEND_COLOR = 'rgba(239, 68, 68, 0.2)';

  getDaySeparators(timestamps: Time[]): DaySeparator[] {
    if (timestamps.length === 0) {
      console.log('[ChartOverlay] No timestamps provided for day separators');
      return [];
    }

    const separators: DaySeparator[] = [];
    const days = new Map<string, { start: number; end: number; dayOfWeek: number }>();

    timestamps.forEach(time => {
      const timestamp = typeof time === 'number' ? time * 1000 : new Date(time as string).getTime();
      const date = new Date(timestamp);
      const dayKey = this.getDayKey(date);
      const dayOfWeek = date.getDay();

      if (!days.has(dayKey)) {
        days.set(dayKey, {
          start: timestamp,
          end: timestamp,
          dayOfWeek
        });
      } else {
        const day = days.get(dayKey)!;
        day.end = Math.max(day.end, timestamp);
      }
    });

    const sortedDays = Array.from(days.entries())
      .sort((a, b) => a[1].start - b[1].start);

    sortedDays.forEach(([_, day], index) => {
      const isAlternate = index % 2 === 0;
      separators.push({
        startTime: Math.floor(day.start / 1000),
        endTime: Math.floor(day.end / 1000),
        dayOfWeek: day.dayOfWeek,
        isAlternate,
        color: isAlternate ? this.DAY_COLOR_LIGHT : this.DAY_COLOR_DARK
      });
    });

    console.log(`[ChartOverlay] Generated ${separators.length} day separators`);
    return separators;
  }

  getWeekendOverlays(timestamps: Time[]): WeekendOverlay[] {
    if (timestamps.length === 0) {
      console.log('[ChartOverlay] No timestamps provided for weekend overlays');
      return [];
    }

    const overlays: WeekendOverlay[] = [];
    const weekends = new Map<string, { start: number; end: number }>();

    timestamps.forEach(time => {
      const timestamp = typeof time === 'number' ? time * 1000 : new Date(time as string).getTime();
      const date = new Date(timestamp);

      if (marketHoursService.isWeekend(date)) {
        const weekKey = this.getWeekKey(date);

        if (!weekends.has(weekKey)) {
          weekends.set(weekKey, {
            start: timestamp,
            end: timestamp
          });
        } else {
          const weekend = weekends.get(weekKey)!;
          weekend.end = Math.max(weekend.end, timestamp);
        }
      }
    });

    weekends.forEach(weekend => {
      overlays.push({
        startTime: Math.floor(weekend.start / 1000),
        endTime: Math.floor(weekend.end / 1000),
        color: this.WEEKEND_COLOR
      });
    });

    console.log(`[ChartOverlay] Generated ${overlays.length} weekend overlays`);
    return overlays;
  }

  private getDayKey(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  private getWeekKey(date: Date): string {
    const weekStart = new Date(date);
    weekStart.setDate(date.getDate() - date.getDay());
    return this.getDayKey(weekStart);
  }
}

export const chartOverlayService = new ChartOverlayService();
