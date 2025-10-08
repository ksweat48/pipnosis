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
}

export const marketHoursService = new MarketHoursService();
