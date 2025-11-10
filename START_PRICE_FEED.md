# Start Price Feed - Run in Background

## Quick Commands

### Start Emergency Feed
```bash
# Option 1: Run in terminal (see output)
python3 emergency-price-feed.py

# Option 2: Run in background (no output)
nohup python3 emergency-price-feed.py > price-feed.log 2>&1 &
echo $! > price-feed.pid
echo "Price feed started. PID saved to price-feed.pid"

# Option 3: Run with screen (detachable terminal)
screen -S price-feed python3 emergency-price-feed.py
# Press Ctrl+A, then D to detach
# Reattach with: screen -r price-feed
```

### Stop Emergency Feed
```bash
# If you saved the PID
kill $(cat price-feed.pid)

# Or find and kill manually
ps aux | grep emergency-price-feed
kill <PID>
```

### Check Status
```bash
# Check if running
ps aux | grep emergency-price-feed

# View logs (if running with nohup)
tail -f price-feed.log

# Check database (should see prices < 5 seconds old)
psql "$SUPABASE_DB_URL" -c "
SELECT symbol, created_at,
       EXTRACT(EPOCH FROM (NOW() - created_at)) as seconds_old
FROM realtime_prices
WHERE source = 'emergency_feed'
ORDER BY created_at DESC
LIMIT 5;
"
```

## Using Docker (Optional)

If you want to run the emergency feed in a container:

```dockerfile
# Create Dockerfile
FROM python:3.11-slim

WORKDIR /app
COPY emergency-price-feed.py .

CMD ["python3", "emergency-price-feed.py"]
```

```bash
# Build and run
docker build -t price-feed .
docker run -d --name price-feed --restart unless-stopped price-feed

# View logs
docker logs -f price-feed

# Stop
docker stop price-feed
```

## Using systemd Service (Linux)

Create a systemd service for automatic startup:

```bash
# Create service file
sudo tee /etc/systemd/system/pipnosis-price-feed.service << EOF
[Unit]
Description=Pipnosis Emergency Price Feed
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$(pwd)
ExecStart=/usr/bin/python3 $(pwd)/emergency-price-feed.py
Restart=always
RestartSec=10
StandardOutput=append:$(pwd)/price-feed.log
StandardError=append:$(pwd)/price-feed.log

[Install]
WantedBy=multi-user.target
EOF

# Enable and start
sudo systemctl daemon-reload
sudo systemctl enable pipnosis-price-feed
sudo systemctl start pipnosis-price-feed

# Check status
sudo systemctl status pipnosis-price-feed

# View logs
sudo journalctl -u pipnosis-price-feed -f
```

## Production Deployment

### On a VPS/Server

1. **Upload the script**:
   ```bash
   scp emergency-price-feed.py user@your-server:/path/to/app/
   ```

2. **Setup systemd service** (see above)

3. **Monitor**:
   ```bash
   ssh user@your-server 'sudo systemctl status pipnosis-price-feed'
   ```

### On Heroku

```bash
# Create a simple Procfile
echo "worker: python3 emergency-price-feed.py" > Procfile

# Deploy
heroku create pipnosis-price-feed
git push heroku main

# Scale worker
heroku ps:scale worker=1
```

### On Railway/Render

Similar to Heroku - these platforms auto-detect Python apps and can run background workers.

## Monitoring Script

Create `check-price-feed.sh`:

```bash
#!/bin/bash

# Check if prices are fresh
LATEST=$(psql "$SUPABASE_DB_URL" -t -c "
SELECT EXTRACT(EPOCH FROM (NOW() - MAX(created_at)))
FROM realtime_prices
WHERE source = 'emergency_feed';
")

if (( $(echo "$LATEST > 30" | bc -l) )); then
  echo "❌ Price feed is stale! Last update: ${LATEST}s ago"
  # Restart the feed
  kill $(cat price-feed.pid) 2>/dev/null
  sleep 2
  nohup python3 emergency-price-feed.py > price-feed.log 2>&1 &
  echo $! > price-feed.pid
  echo "✅ Price feed restarted"
else
  echo "✅ Price feed is healthy. Last update: ${LATEST}s ago"
fi
```

```bash
# Make executable
chmod +x check-price-feed.sh

# Run every minute via cron
crontab -e
# Add this line:
# * * * * * /path/to/check-price-feed.sh >> /path/to/monitor.log 2>&1
```

## Alternative: Run on Free Tier Cloud

### Replit (Free)

1. Create new Python Repl
2. Upload `emergency-price-feed.py`
3. Click "Run"
4. Keep tab open (or upgrade to Always On)

### PythonAnywhere (Free)

1. Sign up for free account
2. Upload script to Files
3. Create "Always-on" task in Dashboard
4. Set to run `python3 /path/to/emergency-price-feed.py`

### Glitch (Free)

1. Create new project
2. Add `emergency-price-feed.py`
3. Runs automatically (stays awake if visited periodically)

## Troubleshooting

### Script Crashes

```bash
# Add auto-restart wrapper
cat > run-with-restart.sh << 'EOF'
#!/bin/bash
while true; do
  echo "Starting price feed at $(date)"
  python3 emergency-price-feed.py
  echo "Price feed stopped at $(date), restarting in 5 seconds..."
  sleep 5
done
EOF

chmod +x run-with-restart.sh
nohup ./run-with-restart.sh > price-feed.log 2>&1 &
```

### Memory Issues

The script uses minimal memory (~10MB), but if needed:

```python
# Add to emergency-price-feed.py after imports
import gc

# In the main loop, after each batch:
if counter % 100 == 0:  # Every 200 seconds
    gc.collect()
```

### Connection Issues

If Supabase connections are failing, add retry logic:

```python
# Modify insert_price function to retry 3 times
def insert_price_with_retry(symbol, bid, ask, mid, spread, timestamp, retries=3):
    for attempt in range(retries):
        try:
            if insert_price(symbol, bid, ask, mid, spread, timestamp):
                return True
            time.sleep(1)
        except Exception:
            if attempt == retries - 1:
                raise
            time.sleep(2)
    return False
```

## Summary

- **Development**: Run `python3 emergency-price-feed.py` in terminal
- **Testing**: Run with `nohup` in background
- **Production**: Use systemd service or cloud platform
- **Monitoring**: Setup cron job to check freshness

Your live ticks will flow continuously as long as this script is running!
