/**
 * MetaApi Cost Calculator Utility
 * 
 * Calculates estimated costs for MetaApi usage based on session duration
 * and MetaApi's pricing structure for hosted MT5 infrastructure.
 */

/**
 * MetaApi pricing breakdown (per hour, per active account):
 * - Base account slot: $0.0015/hr
 * - MetaStats API: $0.0015/hr  
 * - Frontend server slot: $0.0015/hr
 * - Resource slot: $0.0015/hr
 * Total: $0.006/hr per user session
 */
const METAAPI_HOURLY_RATE = 0.006;

/**
 * Calculate estimated MetaApi cost based on session duration
 * @param {number} durationMinutes - Duration of the trading session in minutes
 * @returns {number} Estimated cost in USD (rounded to 4 decimal places)
 */
export function estimateMetaApiCost(durationMinutes) {
  if (!durationMinutes || durationMinutes <= 0) {
    return 0.0000;
  }
  
  const durationHours = durationMinutes / 60;
  const cost = durationHours * METAAPI_HOURLY_RATE;
  
  return parseFloat(cost.toFixed(4));
}

/**
 * Calculate projected daily cost based on average session metrics
 * @param {number} averageSessionDuration - Average session duration in minutes
 * @param {number} sessionsPerDay - Number of sessions per day
 * @returns {number} Projected daily cost in USD
 */
export function calculateDailyCostProjection(averageSessionDuration, sessionsPerDay) {
  const costPerSession = estimateMetaApiCost(averageSessionDuration);
  return parseFloat((costPerSession * sessionsPerDay).toFixed(4));
}

/**
 * Calculate projected monthly cost based on daily metrics
 * @param {number} dailyCost - Daily cost in USD
 * @param {number} daysInMonth - Number of days in the month (default: 30)
 * @returns {number} Projected monthly cost in USD
 */
export function calculateMonthlyCostProjection(dailyCost, daysInMonth = 30) {
  return parseFloat((dailyCost * daysInMonth).toFixed(2));
}

/**
 * Get cost breakdown for a list of trade sessions
 * @param {Array} sessions - Array of trade session objects
 * @returns {Object} Cost breakdown with totals and per-user data
 */
export function getCostBreakdown(sessions) {
  const breakdown = {
    totalCost: 0,
    totalSessions: sessions.length,
    totalDuration: 0,
    averageCostPerSession: 0,
    averageDuration: 0,
    userBreakdown: {}
  };

  // Calculate totals and per-user breakdown
  sessions.forEach(session => {
    const cost = session.estimated_cost || 0;
    const duration = session.duration_minutes || 0;
    
    breakdown.totalCost += cost;
    breakdown.totalDuration += duration;
    
    // Per-user breakdown
    const userId = session.user_id;
    if (!breakdown.userBreakdown[userId]) {
      breakdown.userBreakdown[userId] = {
        userId,
        totalCost: 0,
        sessionCount: 0,
        totalDuration: 0,
        averageCost: 0,
        averageDuration: 0
      };
    }
    
    breakdown.userBreakdown[userId].totalCost += cost;
    breakdown.userBreakdown[userId].sessionCount += 1;
    breakdown.userBreakdown[userId].totalDuration += duration;
  });

  // Calculate averages
  if (breakdown.totalSessions > 0) {
    breakdown.averageCostPerSession = parseFloat((breakdown.totalCost / breakdown.totalSessions).toFixed(4));
    breakdown.averageDuration = Math.round(breakdown.totalDuration / breakdown.totalSessions);
  }

  // Calculate per-user averages
  Object.values(breakdown.userBreakdown).forEach(userStats => {
    if (userStats.sessionCount > 0) {
      userStats.averageCost = parseFloat((userStats.totalCost / userStats.sessionCount).toFixed(4));
      userStats.averageDuration = Math.round(userStats.totalDuration / userStats.sessionCount);
    }
  });

  return breakdown;
}

/**
 * Generate mock trade session data for testing
 * @param {number} count - Number of mock sessions to generate
 * @param {Array} userIds - Array of user IDs to assign sessions to
 * @returns {Array} Array of mock trade session objects
 */
export function generateMockTradeSessions(count = 10, userIds = ['user1', 'user2', 'user3']) {
  const symbols = ['EURUSD', 'GBPUSD', 'USDJPY'];
  const sessions = [];
  
  for (let i = 0; i < count; i++) {
    const startTime = new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000); // Random time in last 7 days
    const duration = Math.floor(Math.random() * 150) + 30; // 30-180 minutes
    const endTime = new Date(startTime.getTime() + duration * 60 * 1000);
    
    const session = {
      id: `mock-${i}`,
      user_id: userIds[Math.floor(Math.random() * userIds.length)],
      symbol: symbols[Math.floor(Math.random() * symbols.length)],
      start_time: startTime.toISOString(),
      end_time: endTime.toISOString(),
      status: 'closed',
      duration_minutes: duration,
      estimated_cost: estimateMetaApiCost(duration),
      created_at: startTime.toISOString(),
      updated_at: endTime.toISOString()
    };
    
    sessions.push(session);
  }
  
  return sessions;
}

/**
 * Constants for easy reference
 */
export const COST_CONSTANTS = {
  HOURLY_RATE: METAAPI_HOURLY_RATE,
  AVERAGE_TRADE_DURATION: 120, // 2 hours in minutes
  ESTIMATED_COST_PER_TRADE: estimateMetaApiCost(120) // $0.012
};