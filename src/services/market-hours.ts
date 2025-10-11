export interface MarketDay {
  date: Date;
  isWeekend: boolean;
  isHoliday: boolean;
  isTradingDay: boolean;
}

class MarketHoursService {
  private forexHolidays2025: Date[] = [
    new Date('2025-01-01'),
    new Date('2025-12-25'),
  ];

  isWeekend(date: Date): boolean {
    const day = date.getDay();
    return day === 0 || day === 6;
  }

  isHoliday(date: Date): boolean {
    const dateStr = date.toISOString().split('T')[0];
    return this.forexHolidays2025.some(
      holiday => holiday.toISOString().split('T')[0] === dateStr
    );
  }

  isTradingDay(date: Date): boolean {
    return !this.isWeekend(date) && !this.isHoliday(date);
  }

  getMarketDayInfo(date: Date): MarketDay {
    const isWeekend = this.isWeekend(date);
    const isHoliday = this.isHoliday(date);
    return {
      date,
      isWeekend,
      isHoliday,
      isTradingDay: !isWeekend && !isHoliday
    };
  }

  getTradingDaysBetween(startDate: Date, endDate: Date): Date[] {
    const tradingDays: Date[] = [];
    const current = new Date(startDate);
    current.setHours(0, 0, 0, 0);

    const end = new Date(endDate);
    end.setHours(0, 0, 0, 0);

    while (current <= end) {
      if (this.isTradingDay(current)) {
        tradingDays.push(new Date(current));
      }
      current.setDate(current.getDate() + 1);
    }

    return tradingDays;
  }

  getDayOfWeekName(date: Date): string {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return days[date.getDay()];
  }

  getCurrentMarketClosePeriod(fromDate: Date): { start: Date; end: Date } | null {
    const current = new Date(fromDate);

    if (!this.isTradingDay(current)) {
      const start = new Date(current);
      start.setHours(0, 0, 0, 0);

      while (start.getTime() > 0 && !this.isTradingDay(new Date(start.getTime() - 24 * 60 * 60 * 1000))) {
        start.setDate(start.getDate() - 1);
      }

      let end = new Date(current);
      end.setHours(0, 0, 0, 0);

      while (!this.isTradingDay(end)) {
        end.setDate(end.getDate() + 1);
        if (end.getTime() - start.getTime() > 7 * 24 * 60 * 60 * 1000) {
          break;
        }
      }

      end.setDate(end.getDate() - 1);
      end.setHours(23, 59, 59, 999);

      return { start, end };
    }

    return null;
  }

  getNextMarketClosePeriod(fromDate: Date): { start: Date; end: Date } | null {
    const current = new Date(fromDate);
    current.setHours(0, 0, 0, 0);

    const startCheckFrom = this.isTradingDay(current) ? 1 : 0;

    for (let i = startCheckFrom; i < 30; i++) {
      const checkDate = new Date(current);
      checkDate.setDate(checkDate.getDate() + i);

      if (!this.isTradingDay(checkDate)) {
        const start = new Date(checkDate);
        start.setHours(0, 0, 0, 0);

        let end = new Date(start);

        while (!this.isTradingDay(end)) {
          end.setDate(end.getDate() + 1);
          if (end.getTime() - start.getTime() > 7 * 24 * 60 * 60 * 1000) {
            break;
          }
        }

        end.setDate(end.getDate() - 1);
        end.setHours(23, 59, 59, 999);

        return { start, end };
      }
    }

    return null;
  }
}

export const marketHoursService = new MarketHoursService();
