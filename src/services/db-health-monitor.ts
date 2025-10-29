class DbHealthMonitor {
  private intervalId: NodeJS.Timeout | null = null;

  startMonitoring(): void {
    console.log('Database health monitoring started');
    this.intervalId = setInterval(() => {
      console.log('Database health check');
    }, 30000);
  }

  stopMonitoring(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log('Database health monitoring stopped');
    }
  }
}

export const dbHealthMonitor = new DbHealthMonitor();
