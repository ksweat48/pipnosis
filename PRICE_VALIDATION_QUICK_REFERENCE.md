# Price Validation Quick Reference

## Current Validation Ranges (Dec 2025)

### Major Forex
| Symbol | Min | Max | Typical | Current Price |
|--------|-----|-----|---------|---------------|
| EURUSD | 0.95 | 1.30 | 1.16 | ~1.16 ✓ |
| GBPUSD | 1.10 | 1.50 | 1.32 | ~1.32 ✓ |
| USDJPY | 100 | 180 | 155 | ~155.5 ✓ |

### Commodities
| Symbol | Min | Max | Typical | Current Price |
|--------|-----|-----|---------|---------------|
| XAUUSD | 2000 | 4500 | 4200 | ~4238 ✓ |
| XAGUSD | 18 | 50 | 30 | - |

### Indices
| Symbol | Min | Max | Typical | Current Price |
|--------|-----|-----|---------|---------------|
| US30 | 35000 | 52000 | 47500 | ~47517 ✓ |
| SPX500 | 3800 | 6200 | 5000 | - |
| NAS100 | 12000 | 21000 | 16200 | - |

---

## How to Check for Issues

### In Browser Console
Look for these log patterns:

**✅ Good (Normal):**
```
[Chart] [PriceValidation] ✓ XAUUSD price 4238.11 valid
```

**⚠️ Warning (Unusual but valid):**
```
[Chart] [PriceValidation] ⚠️ UNUSUAL XAUUSD price 4450
  (45% from typical 4200)
```

**❌ Error (Out of range):**
```
[Chart] [PriceValidation] ❌ REJECTED XAUUSD price 4600
  (expected 2000-4500)
```

**🚨 Critical (Cross-contamination):**
```
[Chart] [PriceValidation] 🚨 CROSS-CONTAMINATION DETECTED:
  XAUUSD received SPX500 price 5000
```

---

## When to Update Ranges

Update ranges when:

1. **Price sustained outside range for >1 week**
   - Example: Gold rallies to 4600 and stays there

2. **Multiple symbols showing unusual warnings**
   - Indicates market regime change

3. **False positive contamination alerts**
   - Like the issue we just fixed (Gold at 4240 rejected as "too high")

---

## How to Update Ranges

1. Check current market prices in database:
```sql
SELECT DISTINCT ON (symbol) symbol,
  (bid::numeric + ask::numeric) / 2 as mid_price
FROM realtime_prices
WHERE symbol IN ('XAUUSD', 'EURUSD', 'GBPUSD')
ORDER BY symbol, created_at DESC;
```

2. Edit `/src/services/price-validation-service.ts`

3. Run `npm run build` to verify

4. Deploy with:
```bash
curl -X POST -d '{}' https://api.netlify.com/build_hooks/68965660f2a0a7d94873ccca
```

---

## Emergency Bypass

If validation is blocking legitimate prices:

```typescript
// In price-validation-service.ts
// Temporarily widen range for affected symbol
XAUUSD: { min: 1800, max: 5000, typical: 4200 }
```

Then investigate and update to proper range.

---

**Last Updated:** December 1, 2025
**Next Review:** March 1, 2026 (quarterly)
