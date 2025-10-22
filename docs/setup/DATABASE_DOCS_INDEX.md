# Pipnosis Database Documentation Index

This is a quick reference guide to all database-related documentation in this project.

## Quick Start (START HERE!)

📄 **[QUICK_START_DATABASE.md](QUICK_START_DATABASE.md)**
- 3-step guide to fix the "policy already exists" error
- What changed and why
- Quick troubleshooting

📄 **[DATABASE_SETUP.md](DATABASE_SETUP.md)**
- Complete setup instructions
- What gets created
- Troubleshooting guide
- File locations

## Current Migration Strategy

📄 **[supabase/README.md](supabase/README.md)**
- Official migration strategy documentation
- Schema overview
- Security and performance details
- Version history

📁 **Active Migration File:**
- `supabase/migrations/20251016_100000_consolidated_schema.sql`
- This is the ONLY file you should run
- Idempotent and safe to run multiple times

📁 **Original Consolidated File:**
- `CONSOLIDATED_MIGRATION.sql` (project root)
- Same content as the active migration
- Kept for reference

## Migration Consolidation Details

📄 **[MIGRATION_CONSOLIDATION_SUMMARY.md](MIGRATION_CONSOLIDATION_SUMMARY.md)**
- What was changed on October 16, 2025
- Problem and solution
- Complete technical details
- Before/after file structure

📄 **[HOW_TO_APPLY_MIGRATION.md](HOW_TO_APPLY_MIGRATION.md)**
- Detailed step-by-step migration guide
- Verification queries
- Troubleshooting section
- Security notes

## Development Tools

📄 **[supabase/scripts/RESET_DATABASE.sql](supabase/scripts/RESET_DATABASE.sql)**
- Development-only reset script
- Drops all tables and data
- ⚠️ WARNING: Do not use in production!

## Archived Migrations

📁 **supabase/migrations_archive/**
- Contains 40 archived migration files
- Preserved for historical reference
- ⚠️ DO NOT RUN these files

📄 **[supabase/migrations_archive/README.md](supabase/migrations_archive/README.md)**
- Why files were archived
- What replaced them
- Historical context

## Historical Documentation

These documents describe issues that have been resolved in the consolidated migration:

📄 **[SQL_MIGRATION_FIX.md](SQL_MIGRATION_FIX.md)**
- Reserved keyword issue (historical)
- Resolved in consolidated migration

## Other Database-Related Docs

📄 **[db-setup-guide.md](db-setup-guide.md)**
- Alternative setup guide
- May contain older information

📄 **Implementation Guides:**
- `AI_TRADING_BRAIN_IMPLEMENTATION.md` - AI trading brain tables
- `FX_FLOW_SCALPER_V2_IMPLEMENTATION.md` - FX Flow scalper strategy
- `HISTORICAL_CANDLES_GUIDE.md` - Historical candles setup
- And others in the project root

## Recommended Reading Order

1. **First Time Setup:**
   1. `QUICK_START_DATABASE.md` - Get up and running quickly
   2. `DATABASE_SETUP.md` - Understand what's happening
   3. `HOW_TO_APPLY_MIGRATION.md` - Detailed instructions

2. **Understanding the Changes:**
   1. `MIGRATION_CONSOLIDATION_SUMMARY.md` - What changed and why
   2. `supabase/README.md` - Complete migration strategy
   3. `supabase/migrations_archive/README.md` - What was archived

3. **Development:**
   1. Review the active migration file
   2. Check `supabase/scripts/RESET_DATABASE.sql` for resets
   3. Refer to implementation guides as needed

## File Locations Quick Reference

```
project/
├── CONSOLIDATED_MIGRATION.sql                 # Original (for reference)
├── QUICK_START_DATABASE.md                    # ⭐ Start here
├── DATABASE_SETUP.md                          # ⭐ Detailed setup
├── DATABASE_DOCS_INDEX.md                     # This file
├── MIGRATION_CONSOLIDATION_SUMMARY.md         # What changed
├── HOW_TO_APPLY_MIGRATION.md                  # Step-by-step guide
├── SQL_MIGRATION_FIX.md                       # Historical issue
├── db-setup-guide.md                          # Alternative guide
└── supabase/
    ├── README.md                              # ⭐ Official docs
    ├── migrations/
    │   └── 20251016_100000_consolidated_schema.sql  # ⭐ RUN THIS
    ├── migrations_archive/
    │   ├── README.md                          # Archive explanation
    │   └── [40 archived .sql files]           # Historical reference
    └── scripts/
        └── RESET_DATABASE.sql                 # Dev reset (⚠️ deletes data)
```

## Getting Help

If you're stuck:

1. Check `QUICK_START_DATABASE.md` for common issues
2. Review `DATABASE_SETUP.md` troubleshooting section
3. Verify you're using the correct migration file
4. Check Supabase logs in your dashboard
5. Make sure your user has `is_admin = true`

## Last Updated

This index was created on: **October 16, 2025**

After completing the migration consolidation that resolved the "policy already exists" error.

---

**Remember:** Always use the consolidated migration file, not the archived individual migrations!
