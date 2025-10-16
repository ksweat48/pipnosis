# Archived Migrations

## About This Directory

This directory contains **40 archived migration files** from the incremental migration approach used prior to October 16, 2025.

## Important Notice

**⚠️ DO NOT RUN THESE MIGRATION FILES! ⚠️**

These files are archived for historical reference only. Running them may cause:
- Duplicate policy errors
- Conflicting schema changes
- Data integrity issues
- RLS policy conflicts

## What Replaced These?

All functionality from these 40 migration files has been consolidated into:

```
../migrations/20251016_100000_consolidated_schema.sql
```

This single consolidated migration file includes all schema changes, policies, indexes, and functions from the archived migrations in a clean, idempotent format.

## Why Were They Archived?

The project migrated from an incremental migration strategy to a consolidated approach for several reasons:

1. **Eliminated Policy Conflicts** - Multiple migrations created the same RLS policies, causing errors
2. **Simplified Setup** - New developers can run one file instead of 40 sequential migrations
3. **Improved Maintainability** - Single source of truth for the entire schema
4. **Idempotent Design** - Can be safely re-run without errors
5. **Better Documentation** - Complete schema overview in one place

## Historical Reference

These files represent the evolution of the Pipnosis database schema from June 2025 through October 2025.

Key milestones included:
- Initial schema setup
- Market data storage implementation
- Auto trading features
- AI trading brain tables
- Admin analytics views
- Performance optimizations
- RLS policy fixes

## Archive Date

All files in this directory were archived on: **October 16, 2025**

## Questions?

If you need to reference the old migration history or understand how specific features evolved, these files provide that context. However, for all practical purposes, use the consolidated migration file instead.

For current database setup instructions, see: `../README.md`
