# save_credentials.py

from mt5_connector import MT5Connector

# Save login credentials
connector = MT5Connector()
success = connector.save_credentials("5035298146", "-0UmBmRm", "MetaQuotes-Demo")

if success:
    print("✅ Credentials saved")
else:
    print("❌ Failed to save credentials")
