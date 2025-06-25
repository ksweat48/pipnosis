"""
Pipnosis Connector Installer - Production Version
Creates a Windows executable and installer for the MT5 connector

This script packages the Pipnosis Connector into a standalone Windows application
with auto-startup capabilities and a professional installer.

Requirements:
- pip install pyinstaller inno-setup-compiler
- Windows 10+ (64-bit)
"""

import os
import subprocess
import sys
import shutil
import json
from pathlib import Path
import tempfile
import requests
from datetime import datetime

class ConnectorInstaller:
    def __init__(self):
        self.version = "2.1.0"
        self.app_name = "Pipnosis Connector"
        self.build_dir = Path("build")
        self.dist_dir = Path("dist")
        self.installer_dir = Path("installer")
        
        # Create directories
        for dir_path in [self.build_dir, self.dist_dir, self.installer_dir]:
            dir_path.mkdir(exist_ok=True)
    
    def check_requirements(self):
        """Check if all required tools are installed"""
        print("🔍 Checking requirements...")
        
        requirements = [
            ("python", "Python 3.8+"),
            ("pip", "Python package manager"),
        ]
        
        missing = []
        for cmd, desc in requirements:
            try:
                subprocess.run([cmd, "--version"], capture_output=True, check=True)
                print(f"✅ {desc}")
            except (subprocess.CalledProcessError, FileNotFoundError):
                print(f"❌ {desc}")
                missing.append(desc)
        
        # Check Python packages
        python_packages = [
            "pyinstaller",
            "MetaTrader5",
            "requests",
            "cryptography",
            "psutil"
        ]
        
        for package in python_packages:
            try:
                __import__(package)
                print(f"✅ {package}")
            except ImportError:
                print(f"❌ {package}")
                missing.append(f"Python package: {package}")
        
        if missing:
            print(f"\n❌ Missing requirements: {', '.join(missing)}")
            print("Please install missing requirements and try again.")
            return False
        
        print("✅ All requirements satisfied")
        return True
    
    def create_executable(self):
        """Create standalone executable using PyInstaller"""
        print("📦 Creating Pipnosis Connector executable...")
        
        # PyInstaller command with enhanced options
        cmd = [
            'pyinstaller',
            '--onefile',
            '--windowed',
            '--name=PipnosisConnector',
            '--icon=assets/pipnosis_icon.ico',
            '--add-data=assets/pipnosis_icon.ico;assets',
            '--hidden-import=MetaTrader5',
            '--hidden-import=requests',
            '--hidden-import=cryptography',
            '--hidden-import=psutil',
            '--hidden-import=configparser',
            '--hidden-import=threading',
            '--hidden-import=json',
            '--hidden-import=base64',
            '--hidden-import=hashlib',
            '--version-file=version_info.txt',
            '--distpath=dist',
            '--workpath=build',
            '--specpath=build',
            'mt5_connector_enhanced.py'
        ]
        
        try:
            # Create version info file
            self.create_version_info()
            
            # Run PyInstaller
            result = subprocess.run(cmd, check=True, capture_output=True, text=True)
            print("✅ Executable created successfully!")
            print(f"📁 Location: {self.dist_dir / 'PipnosisConnector.exe'}")
            return True
            
        except subprocess.CalledProcessError as e:
            print(f"❌ Failed to create executable: {e}")
            print(f"Error output: {e.stderr}")
            return False
    
    def create_version_info(self):
        """Create version info file for Windows executable"""
        version_info = f"""
# UTF-8
VSVersionInfo(
  ffi=FixedFileInfo(
    filevers=({self.version.replace('.', ', ')}, 0),
    prodvers=({self.version.replace('.', ', ')}, 0),
    mask=0x3f,
    flags=0x0,
    OS=0x40004,
    fileType=0x1,
    subtype=0x0,
    date=(0, 0)
  ),
  kids=[
    StringFileInfo(
      [
        StringTable(
          u'040904B0',
          [
            StringStruct(u'CompanyName', u'Pipnosis AI'),
            StringStruct(u'FileDescription', u'Pipnosis MT5 Connector'),
            StringStruct(u'FileVersion', u'{self.version}'),
            StringStruct(u'InternalName', u'PipnosisConnector'),
            StringStruct(u'LegalCopyright', u'© 2024 Pipnosis AI. All rights reserved.'),
            StringStruct(u'OriginalFilename', u'PipnosisConnector.exe'),
            StringStruct(u'ProductName', u'Pipnosis Connector'),
            StringStruct(u'ProductVersion', u'{self.version}')
          ]
        )
      ]
    ),
    VarFileInfo([VarStruct(u'Translation', [1033, 1200])])
  ]
)
"""
        with open('version_info.txt', 'w') as f:
            f.write(version_info)
    
    def create_installer_script(self):
        """Create Inno Setup script for Windows installer"""
        print("📝 Creating installer script...")
        
        inno_script = f"""
; Pipnosis Connector Installer Script
; Generated by Pipnosis Installer v{self.version}

#define MyAppName "Pipnosis Connector"
#define MyAppVersion "{self.version}"
#define MyAppPublisher "Pipnosis AI"
#define MyAppURL "https://pipnosis.com"
#define MyAppExeName "PipnosisConnector.exe"

[Setup]
AppId={{{{B8E8F8F0-8F8F-4F8F-8F8F-8F8F8F8F8F8F}}}}
AppName={{#MyAppName}}
AppVersion={{#MyAppVersion}}
AppVerName={{#MyAppName}} {{#MyAppVersion}}
AppPublisher={{#MyAppPublisher}}
AppPublisherURL={{#MyAppURL}}
AppSupportURL={{#MyAppURL}}
AppUpdatesURL={{#MyAppURL}}
DefaultDirName={{autopf}}\\{{#MyAppName}}
DefaultGroupName={{#MyAppName}}
AllowNoIcons=yes
LicenseFile=LICENSE.txt
InfoBeforeFile=README.txt
OutputDir=installer
OutputBaseFilename=PipnosisConnectorSetup_v{self.version}
SetupIconFile=assets\\pipnosis_icon.ico
Compression=lzma
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
ArchitecturesAllowed=x64
ArchitecturesInstallIn64BitMode=x64

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{{cm:CreateDesktopIcon}}"; GroupDescription: "{{cm:AdditionalIcons}}"; Flags: unchecked
Name: "quicklaunchicon"; Description: "{{cm:CreateQuickLaunchIcon}}"; GroupDescription: "{{cm:AdditionalIcons}}"; Flags: unchecked; OnlyBelowVersion: 6.1
Name: "autostart"; Description: "Start Pipnosis Connector automatically with Windows"; GroupDescription: "Startup Options"; Flags: checked

[Files]
Source: "dist\\PipnosisConnector.exe"; DestDir: "{{app}}"; Flags: ignoreversion
Source: "assets\\pipnosis_icon.ico"; DestDir: "{{app}}\\assets"; Flags: ignoreversion
Source: "README.txt"; DestDir: "{{app}}"; Flags: ignoreversion
Source: "LICENSE.txt"; DestDir: "{{app}}"; Flags: ignoreversion

[Icons]
Name: "{{group}}\\{{#MyAppName}}"; Filename: "{{app}}\\{{#MyAppExeName}}"
Name: "{{group}}\\{{cm:UninstallProgram,{{#MyAppName}}}}"; Filename: "{{uninstallexe}}"
Name: "{{autodesktop}}\\{{#MyAppName}}"; Filename: "{{app}}\\{{#MyAppExeName}}"; Tasks: desktopicon
Name: "{{userappdata}}\\Microsoft\\Internet Explorer\\Quick Launch\\{{#MyAppName}}"; Filename: "{{app}}\\{{#MyAppExeName}}"; Tasks: quicklaunchicon

[Registry]
Root: HKCU; Subkey: "Software\\Microsoft\\Windows\\CurrentVersion\\Run"; ValueType: string; ValueName: "PipnosisConnector"; ValueData: "{{app}}\\{{#MyAppExeName}}"; Flags: uninsdeletevalue; Tasks: autostart

[Run]
Filename: "{{app}}\\{{#MyAppExeName}}"; Description: "{{cm:LaunchProgram,{{#StringChange(MyAppName, '&', '&&')}}}}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
Type: filesandordirs; Name: "{{userappdata}}\\Pipnosis"

[Code]
function GetUninstallString(): String;
var
  sUnInstPath: String;
  sUnInstallString: String;
begin
  sUnInstPath := ExpandConstant('Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{{{{B8E8F8F0-8F8F-4F8F-8F8F-8F8F8F8F8F8F}}}}_is1');
  sUnInstallString := '';
  if not RegQueryStringValue(HKLM, sUnInstPath, 'UninstallString', sUnInstallString) then
    RegQueryStringValue(HKCU, sUnInstPath, 'UninstallString', sUnInstallString);
  Result := sUnInstallString;
end;

function IsUpgrade(): Boolean;
begin
  Result := (GetUninstallString() <> '');
end;

function UnInstallOldVersion(): Integer;
var
  sUnInstallString: String;
  iResultCode: Integer;
begin
  Result := 0;
  sUnInstallString := GetUninstallString();
  if sUnInstallString <> '' then begin
    sUnInstallString := RemoveQuotes(sUnInstallString);
    if Exec(sUnInstallString, '/SILENT /NORESTART /SUPPRESSMSGBOXES','', SW_HIDE, ewWaitUntilTerminated, iResultCode) then
      Result := 3
    else
      Result := 2;
  end else
    Result := 1;
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if (CurStep=ssInstall) then
  begin
    if (IsUpgrade()) then
    begin
      UnInstallOldVersion();
    end;
  end;
end;
"""
        
        script_path = self.installer_dir / "pipnosis_installer.iss"
        with open(script_path, 'w') as f:
            f.write(inno_script)
        
        print(f"✅ Installer script created: {script_path}")
        return script_path
    
    def create_documentation(self):
        """Create documentation files for the installer"""
        print("📄 Creating documentation files...")
        
        # README.txt
        readme_content = f"""
Pipnosis Connector v{self.version}
================================

Thank you for installing the Pipnosis Connector!

WHAT IS PIPNOSIS CONNECTOR?
The Pipnosis Connector is a secure bridge application that connects your MetaTrader 5 
terminal with the Pipnosis AI trading system. It enables automated trading while keeping 
your credentials safe and secure on your local machine.

GETTING STARTED:
1. Make sure MetaTrader 5 is installed and running
2. Configure your MT5 account credentials through the Pipnosis web interface
3. The connector will start automatically with Windows
4. Visit https://pipnosis.com to start AI trading

FEATURES:
• Secure local credential encryption
• Real-time market data streaming
• Automated trade execution
• Background operation
• Auto-startup with Windows
• Comprehensive logging

SYSTEM REQUIREMENTS:
• Windows 10 or later (64-bit)
• MetaTrader 5 terminal
• Internet connection
• Administrator privileges (for installation only)

SUPPORT:
• Documentation: https://docs.pipnosis.com
• Support: support@pipnosis.com
• Discord: https://discord.gg/pipnosis

SECURITY:
Your MT5 credentials are encrypted locally and never transmitted to our servers.
Only trade metadata is sent for AI analysis.

© 2024 Pipnosis AI. All rights reserved.
"""
        
        with open('README.txt', 'w') as f:
            f.write(readme_content)
        
        # LICENSE.txt
        license_content = """
Pipnosis Connector License Agreement

Copyright (c) 2024 Pipnosis AI

Permission is hereby granted to use this software in connection with the Pipnosis
AI trading platform, subject to the following conditions:

1. This software is provided "as is" without warranty of any kind
2. Use of this software is subject to the Pipnosis Terms of Service
3. This software may only be used with legitimate MetaTrader 5 accounts
4. Reverse engineering or redistribution is prohibited
5. All trading activities are at your own risk

For full terms and conditions, visit: https://pipnosis.com/terms

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
"""
        
        with open('LICENSE.txt', 'w') as f:
            f.write(license_content)
        
        print("✅ Documentation files created")
    
    def create_assets(self):
        """Create or download required assets"""
        print("🎨 Creating assets...")
        
        assets_dir = Path("assets")
        assets_dir.mkdir(exist_ok=True)
        
        # Create a simple icon if it doesn't exist
        icon_path = assets_dir / "pipnosis_icon.ico"
        if not icon_path.exists():
            print("⚠️ Icon file not found. Please add pipnosis_icon.ico to the assets folder.")
            # Create a placeholder
            with open(icon_path, 'w') as f:
                f.write("# Placeholder icon file")
        
        print("✅ Assets ready")
    
    def build_installer(self):
        """Build the complete installer package"""
        print(f"🏗️ Building Pipnosis Connector v{self.version}...")
        
        # Check requirements
        if not self.check_requirements():
            return False
        
        # Create assets
        self.create_assets()
        
        # Create documentation
        self.create_documentation()
        
        # Create executable
        if not self.create_executable():
            return False
        
        # Create installer script
        script_path = self.create_installer_script()
        
        print("\n✅ Build process completed!")
        print(f"📁 Executable: {self.dist_dir / 'PipnosisConnector.exe'}")
        print(f"📄 Installer script: {script_path}")
        
        print("\n🔧 To create the Windows installer:")
        print("1. Install Inno Setup from https://jrsoftware.org/isinfo.php")
        print(f"2. Open {script_path} in Inno Setup")
        print("3. Click 'Build' to create the installer")
        print(f"4. The installer will be created in the 'installer' folder")
        
        return True
    
    def clean_build(self):
        """Clean build directories"""
        print("🧹 Cleaning build directories...")
        
        dirs_to_clean = [self.build_dir, self.dist_dir]
        files_to_clean = ['version_info.txt', 'README.txt', 'LICENSE.txt']
        
        for dir_path in dirs_to_clean:
            if dir_path.exists():
                shutil.rmtree(dir_path)
                print(f"🗑️ Removed {dir_path}")
        
        for file_path in files_to_clean:
            if os.path.exists(file_path):
                os.remove(file_path)
                print(f"🗑️ Removed {file_path}")
        
        print("✅ Build directories cleaned")

def main():
    """Main installer function"""
    print("🚀 Pipnosis Connector Installer v2.1.0")
    print("=" * 50)
    
    installer = ConnectorInstaller()
    
    if len(sys.argv) > 1 and sys.argv[1] == 'clean':
        installer.clean_build()
        return
    
    try:
        success = installer.build_installer()
        if success:
            print("\n🎉 Build completed successfully!")
            print("The Pipnosis Connector is ready for distribution.")
        else:
            print("\n❌ Build failed. Check the output above for errors.")
    except KeyboardInterrupt:
        print("\n⏹️ Build cancelled by user")
    except Exception as e:
        print(f"\n❌ Unexpected error: {e}")

if __name__ == "__main__":
    main()