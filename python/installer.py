"""
Pipnosis Connector Installer Script
Creates a Windows executable and installer for the MT5 connector

Requirements:
- pip install pyinstaller
- pip install inno-setup (for Windows installer)
"""

import os
import subprocess
import sys
from pathlib import Path

def create_executable():
    """Create standalone executable using PyInstaller"""
    print("Creating Pipnosis Connector executable...")
    
    # PyInstaller command
    cmd = [
        'pyinstaller',
        '--onefile',
        '--windowed',
        '--name=PipnosisConnector',
        '--icon=pipnosis_icon.ico',
        '--add-data=pipnosis_icon.ico;.',
        '--hidden-import=MetaTrader5',
        '--hidden-import=requests',
        '--hidden-import=cryptography',
        'mt5_connector.py'
    ]
    
    try:
        subprocess.run(cmd, check=True)
        print("✅ Executable created successfully!")
        return True
    except subprocess.CalledProcessError as e:
        print(f"❌ Failed to create executable: {e}")
        return False

def create_installer_script():
    """Create Inno Setup script for Windows installer"""
    
    inno_script = """
[Setup]
AppName=Pipnosis Connector
AppVersion=2.1.0
AppPublisher=Pipnosis AI
AppPublisherURL=https://pipnosis.com
DefaultDirName={autopf}\\Pipnosis Connector
DefaultGroupName=Pipnosis
UninstallDisplayIcon={app}\\PipnosisConnector.exe
Compression=lzma2
SolidCompression=yes
OutputDir=installer
OutputBaseFilename=PipnosisConnectorSetup

[Files]
Source: "dist\\PipnosisConnector.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "pipnosis_icon.ico"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\\Pipnosis Connector"; Filename: "{app}\\PipnosisConnector.exe"
Name: "{group}\\Uninstall Pipnosis Connector"; Filename: "{uninstallexe}"
Name: "{autodesktop}\\Pipnosis Connector"; Filename: "{app}\\PipnosisConnector.exe"

[Run]
Filename: "{app}\\PipnosisConnector.exe"; Description: "Launch Pipnosis Connector"; Flags: nowait postinstall skipifsilent

[Registry]
Root: HKCU; Subkey: "Software\\Microsoft\\Windows\\CurrentVersion\\Run"; ValueType: string; ValueName: "PipnosisConnector"; ValueData: "{app}\\PipnosisConnector.exe"; Flags: uninsdeletevalue
"""
    
    with open('pipnosis_installer.iss', 'w') as f:
        f.write(inno_script)
    
    print("✅ Installer script created!")

def main():
    """Main installer function"""
    print("🚀 Pipnosis Connector Build Process")
    print("=" * 40)
    
    # Check if required files exist
    required_files = ['mt5_connector.py', 'requirements.txt']
    for file in required_files:
        if not os.path.exists(file):
            print(f"❌ Required file missing: {file}")
            return
    
    # Install requirements
    print("📦 Installing requirements...")
    subprocess.run([sys.executable, '-m', 'pip', 'install', '-r', 'requirements.txt'])
    subprocess.run([sys.executable, '-m', 'pip', 'install', 'pyinstaller'])
    
    # Create executable
    if create_executable():
        # Create installer script
        create_installer_script()
        
        print("\n✅ Build process completed!")
        print("📁 Executable location: dist/PipnosisConnector.exe")
        print("📄 Installer script: pipnosis_installer.iss")
        print("\n🔧 To create Windows installer:")
        print("1. Install Inno Setup from https://jrsoftware.org/isinfo.php")
        print("2. Open pipnosis_installer.iss in Inno Setup")
        print("3. Click 'Build' to create the installer")
    else:
        print("❌ Build process failed!")

if __name__ == "__main__":
    main()