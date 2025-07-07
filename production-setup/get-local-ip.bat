@echo off
echo Pipnosis MT5 Bridge - Network Information
echo ======================================
echo.
echo This script displays your network information to help you
echo set up port forwarding for the MT5 bridge.
echo.

echo Local IP Addresses:
ipconfig | findstr /i "IPv4"

echo.
echo Public IP Address:
echo Fetching your public IP address...
powershell -Command "try { (Invoke-WebRequest -Uri 'https://api.ipify.org' -UseBasicParsing).Content } catch { 'Could not determine public IP' }"

echo.
echo Port Forwarding Instructions:
echo 1. Access your router's admin page (typically http://192.168.1.1)
echo 2. Navigate to Port Forwarding settings
echo 3. Create a new rule:
echo    - External Port: 8765
echo    - Internal IP: Your local IP address (see above)
echo    - Internal Port: 8765
echo    - Protocol: TCP
echo 4. Save the settings

echo.
echo After setting up port forwarding, use your public IP address
echo in the Pipnosis MT5 Connection settings.
echo.

pause