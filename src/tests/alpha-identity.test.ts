import { ALPHA_IDENTITY } from '../config/alpha-identity';

describe('Alpha Identity Configuration', () => {
  describe('ALPHA_IDENTITY constants', () => {
    it('should have minimum trade confidence retired to 0 (no longer a gate)', () => {
      expect(ALPHA_IDENTITY.MINIMUM_TRADE_CONFIDENCE).toBe(0);
    });

    it('should have correct confidence bands', () => {
      expect(ALPHA_IDENTITY.CONFIDENCE_BANDS.EXCELLENT.min).toBe(85);
      expect(ALPHA_IDENTITY.CONFIDENCE_BANDS.SOLID.min).toBe(70);
      expect(ALPHA_IDENTITY.CONFIDENCE_BANDS.ACCEPTABLE.min).toBe(50);
      expect(ALPHA_IDENTITY.CONFIDENCE_BANDS.DEVELOPING.min).toBe(1);
    });

    it('should expose legitimate block conditions', () => {
      expect(ALPHA_IDENTITY.LEGITIMATE_BLOCK_CONDITIONS).toContain('DATA_STALE');
      expect(ALPHA_IDENTITY.LEGITIMATE_BLOCK_CONDITIONS).toContain('MARKET_CLOSED');
    });
  });
});
