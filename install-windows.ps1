# Windows Installation Script for Dotfiles
# Purpose: Setup Windows native environment and tools for development with WSL
#
# IMPORTANT: This script should be run in Windows PowerShell, NOT in WSL.
# It sets up Windows-specific tools and configures WSL for development.
#
# Setup Process:
# 1. Ensures WSL is properly installed and configured
# 2. Installs development fonts (JetBrains Mono, Hack Nerd Font)
# 3. Installs Windows dev tools (WezTerm, VS Code, Cursor, etc.)
# 4. Configures Windows Terminal
# 5. Installs VS Code & Cursor extensions
# 6. Sets up dotfiles in WSL environment
#
# How to use:
# 1. Open PowerShell as Administrator
# 2. Run: Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
# 3. Run: .\install-windows.ps1
#
# After running this script:
# - Open WSL and run the Linux setup script: ./install.sh

# Ensure we're running with Administrator privileges
if (-NOT ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)) {
    Write-Error "This script must be run with Administrator privileges. Please restart PowerShell as Administrator and try again."
    exit 1
}

# Configuration
$dotfilesDir = $PSScriptRoot
$wslDistro = "Ubuntu"  # Default WSL distribution

# Function to check if a command exists
function Test-Command {
    param ($command)
    return (Get-Command $command -ErrorAction SilentlyContinue)
}

# Function to install a package using winget
function Install-WingetPackage {
    param (
        [string]$Id,
        [string]$Name
    )
    
    Write-Host "Installing $Name..."
    
    # Check if package is already installed
    $installed = winget list --id $Id
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "$Name is already installed."
    } else {
        # Install the package
        winget install --id $Id --accept-source-agreements --accept-package-agreements
        
        if ($LASTEXITCODE -eq 0) {
            Write-Host "$Name installed successfully."
        } else {
            Write-Host "Failed to install $Name."
        }
    }
}

# Function to install WSL
function Install-WSL {
    Write-Host "Setting up WSL environment..."
    
    # Check if WSL is already installed
    if (Test-Command wsl) {
        Write-Host "WSL is already installed."
        
        # Check if WSL 2 is the default
        $wslVersion = wsl --status | Select-String "Default Version"
        
        if ($wslVersion -match "Default Version: 2") {
            Write-Host "WSL 2 is set as the default version."
        } else {
            Write-Host "Setting WSL 2 as the default version..."
            wsl --set-default-version 2
        }
        
        # List available distributions
        Write-Host "Checking for installed WSL distributions..."
        $distroList = wsl --list --verbose | Out-String
        
        # Check if our distribution is already installed
        if ($distroList -match $wslDistro) {
            Write-Host "$wslDistro distribution is already installed."
            return $true
        }
        
        # If we get here, WSL is installed but our distribution is not
        Write-Host "WSL is installed but $wslDistro distribution is not. Installing it now..."
        
        # Instead of wsl --install -d which can cause issues when WSL is already installed
        # We'll try an alternative approach
        $confirmation = Read-Host "Install $wslDistro distribution? (y/N)"
        if ($confirmation -ne 'y' -and $confirmation -ne 'Y') {
            Write-Host "Skipping distribution installation."
            return $true
        }
        
        # Try to install the distribution directly with wsl --import
        # First check if the Microsoft Store package is available
        if (Get-AppxPackage -Name CanonicalGroupLimited.Ubuntu) {
            Write-Host "$wslDistro package is already installed, attempting to launch it..."
            try {
                # Just start the distribution - this will set it up if it's not already set up
                Start-Process "ubuntu" -ArgumentList "install" -NoNewWindow -Wait
                return $true
            } catch {
                Write-Host "Could not start $wslDistro. We'll continue with the setup anyway."
                return $true
            }
        } else {
            # Try to install via Microsoft Store
            Write-Host "Please install $wslDistro from the Microsoft Store manually."
            Write-Host "After installation, run this script again."
            
            # Ask if we should continue anyway
            $continue = Read-Host "Do you want to continue with the setup without installing $wslDistro? (y/N)"
            if ($continue -ne 'y' -and $continue -ne 'Y') {
                exit 1
            }
            return $true
        }
    } else {
        # WSL is not installed at all
        Write-Host "WSL is not installed. Installing it now..."
        
        # First ensure Windows features are enabled
        Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Windows-Subsystem-Linux -NoRestart
        Enable-WindowsOptionalFeature -Online -FeatureName VirtualMachinePlatform -NoRestart
        
        # Set WSL 2 as the default
        Write-Host "Setting WSL 2 as the default version..."
        wsl --set-default-version 2
        
        # Install WSL with default distribution
        Write-Host "Installing WSL with $wslDistro distribution..."
        try {
            wsl --install -d $wslDistro
            Write-Host "WSL setup started. You may need to restart your computer to finish the installation."
            Write-Host "After restart, please run this script again to continue setup."
            exit 0
        } catch {
            Write-Host "Error installing WSL: $($_.Exception.Message)"
            Write-Host "Please try installing WSL manually using 'wsl --install' in PowerShell as Administrator."
            exit 1
        }
    }
    
    return $true
}

# Function to install development fonts
function Install-DevFonts {
    Write-Host "Installing development fonts..."
    
    $fontsFolder = "$env:LOCALAPPDATA\Microsoft\Windows\Fonts"
    $systemFontsFolder = "$env:windir\Fonts"
    
    if (-not (Test-Path $fontsFolder)) {
        New-Item -Path $fontsFolder -ItemType Directory -Force | Out-Null
    }
    
    # Install JetBrains Mono
    $jetbrainsMonoUrl = "https://github.com/JetBrains/JetBrainsMono/releases/download/v2.304/JetBrainsMono-2.304.zip"
    $jetbrainsMonoZip = "$env:TEMP\JetBrainsMono.zip"
    $jetbrainsMonoFolder = "$env:TEMP\JetBrainsMono"
    
    Write-Host "Downloading JetBrains Mono..."
    Invoke-WebRequest -Uri $jetbrainsMonoUrl -OutFile $jetbrainsMonoZip
    
    Write-Host "Extracting JetBrains Mono..."
    Expand-Archive -Path $jetbrainsMonoZip -DestinationPath $jetbrainsMonoFolder -Force
    
    # Install Hack Nerd Font
    $hackNerdFontUrl = "https://github.com/ryanoasis/nerd-fonts/releases/download/v3.0.2/Hack.zip"
    $hackNerdFontZip = "$env:TEMP\HackNerdFont.zip"
    $hackNerdFontFolder = "$env:TEMP\HackNerdFont"
    
    Write-Host "Downloading Hack Nerd Font..."
    Invoke-WebRequest -Uri $hackNerdFontUrl -OutFile $hackNerdFontZip
    
    Write-Host "Extracting Hack Nerd Font..."
    Expand-Archive -Path $hackNerdFontZip -DestinationPath $hackNerdFontFolder -Force
    
    # Install the fonts
    Write-Host "Installing font files..."
    
    # JetBrains Mono
    Get-ChildItem -Path "$jetbrainsMonoFolder\fonts\ttf" -Filter "*.ttf" | ForEach-Object {
        $fontPath = $_.FullName
        $fontName = $_.Name
        
        # Copy to local fonts folder with error handling
        try {
            Copy-Item -Path $fontPath -Destination "$fontsFolder\$fontName" -Force -ErrorAction Stop
            
            # Add registry entry
            New-ItemProperty -Path "HKCU:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts" -Name $fontName -Value "$fontsFolder\$fontName" -PropertyType String -Force | Out-Null
            
            Write-Host "Installed $fontName" -ForegroundColor Green
        } catch {
            # Skip if font is already in use or installed
            Write-Host "Skipped $fontName (already in use or installed)" -ForegroundColor Yellow
        }
    }
    
    # Hack Nerd Font
    Get-ChildItem -Path $hackNerdFontFolder -Filter "*.ttf" | ForEach-Object {
        $fontPath = $_.FullName
        $fontName = $_.Name
        
        # Copy to local fonts folder with error handling
        try {
            Copy-Item -Path $fontPath -Destination "$fontsFolder\$fontName" -Force -ErrorAction Stop
            
            # Add registry entry
            New-ItemProperty -Path "HKCU:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts" -Name $fontName -Value "$fontsFolder\$fontName" -PropertyType String -Force | Out-Null
            
            Write-Host "Installed $fontName" -ForegroundColor Green
        } catch {
            # Skip if font is already in use or installed
            Write-Host "Skipped $fontName (already in use or installed)" -ForegroundColor Yellow
        }
    }
    
    # Clean up
    Remove-Item -Path $jetbrainsMonoZip -Force
    Remove-Item -Path $jetbrainsMonoFolder -Recurse -Force
    Remove-Item -Path $hackNerdFontZip -Force
    Remove-Item -Path $hackNerdFontFolder -Recurse -Force
    
    Write-Host "Fonts installation complete. You may need to restart applications to see the new fonts."
}

# Function to configure Windows Terminal
function Configure-WindowsTerminal {
    Write-Host "Configuring Windows Terminal..."
    
    # Check if Windows Terminal is installed
    if (-not (Test-Command wt)) {
        Write-Host "Windows Terminal not found. Please install it from the Microsoft Store and run this script again."
        return
    }
    
    # Windows Terminal settings path
    $terminalSettingsPath = "$env:LOCALAPPDATA\Packages\Microsoft.WindowsTerminal_8wekyb3d8bbwe\LocalState\settings.json"
    
    # Create backup of existing settings
    if (Test-Path $terminalSettingsPath) {
        $backupPath = "$terminalSettingsPath.backup"
        Copy-Item -Path $terminalSettingsPath -Destination $backupPath -Force
        Write-Host "Backed up existing Windows Terminal settings to $backupPath"
    }
    
    # Windows Terminal settings 
    $terminalSettings = @{
        "$schema" = "https://aka.ms/terminal-profiles-schema"
        "defaultProfile" = "{2c4de342-38b7-51cf-b940-2309a097f518}" # WSL default GUID
        "initialCols" = 120
        "initialRows" = 30
        "alwaysShowTabs" = $true
        "showTabsInTitlebar" = $true
        "showTerminalTitleInTitlebar" = $true
        "tabWidthMode" = "equal"
        "theme" = "dark"
        "profiles" = @{
            "defaults" = @{
                "fontFace" = "Hack Nerd Font Mono"
                "fontSize" = 11
                "useAcrylic" = $false
                "colorScheme" = "One Half Dark"
                "cursorShape" = "underscore"
                "cursorColor" = "#FFFFFF"
                "historySize" = 9001
                "padding" = "8, 8, 8, 8"
                "scrollbarState" = "visible"
                "snapOnInput" = $true
                "startingDirectory" = "%USERPROFILE%"
            }
            "list" = @()
        }
        "schemes" = @()
        "keybindings" = @()
    }
    
    # Add or modify the settings
    Set-Content -Path $terminalSettingsPath -Value (ConvertTo-Json -InputObject $terminalSettings -Depth 10) -Force
    
    Write-Host "Windows Terminal configured successfully. Manual customization may still be required."
}

# Function to install Windows development tools
function Install-DevTools {
    Write-Host "Installing Windows development tools..."
    
    # Check if winget is available
    if (-not (Test-Command winget)) {
        Write-Host "ERROR: winget is not available. Please install the App Installer from the Microsoft Store."
        return
    }
    
    # Install development tools
    Install-WingetPackage -Id "Microsoft.WindowsTerminal" -Name "Windows Terminal"
    Install-WingetPackage -Id "Microsoft.VisualStudioCode" -Name "Visual Studio Code"
    Install-WingetPackage -Id "Git.Git" -Name "Git"
    Install-WingetPackage -Id "Microsoft.PowerShell" -Name "PowerShell"
    Install-WingetPackage -Id "Microsoft.PowerToys" -Name "PowerToys"
    Install-WingetPackage -Id "wez.wezterm" -Name "WezTerm"
    Install-WingetPackage -Id "Cursor.Cursor" -Name "Cursor" # Cursorエディタを追加
    
    # Raycast代替とその他の便利なツール
    Install-WingetPackage -Id "Notion.Notion" -Name "Notion" # ノート・知識管理
    Install-WingetPackage -Id "ShareX.ShareX" -Name "ShareX" # 高度なスクリーンショットと画面キャプチャ

    # Optional tools - uncomment to install
    # Install-WingetPackage -Id "9P7KNL5RWT25" -Name "DevToys" # デベロッパー向けユーティリティツール
    # Install-WingetPackage -Id "voidtools.Everything" -Name "Everything" # 高速ファイル検索
    # Install-WingetPackage -Id "Lexikos.AutoHotkey" -Name "AutoHotkey" # キーボードショートカットとオートメーション
    # Install-WingetPackage -Id "OBSProject.OBSStudio" -Name "OBS Studio" # 画面録画・配信
    # Install-WingetPackage -Id "Microsoft.VisualStudio.2022.Community" -Name "Visual Studio 2022 Community"
    # Install-WingetPackage -Id "JetBrains.IntelliJIDEA.Community" -Name "IntelliJ IDEA Community"
    # Install-WingetPackage -Id "Docker.DockerDesktop" -Name "Docker Desktop"
    # Install-WingetPackage -Id "XSplit.VCam" -Name "XSplit VCam" # バーチャルカメラ
    # Install-WingetPackage -Id "Figma.Figma" -Name "Figma" # デザインツール
    
    Write-Host "Development tools installation complete."
}

# Function to setup dotfiles in WSL
function Setup-WslDotfiles {
    Write-Host "Setting up dotfiles in WSL environment..."
    
    # Get WSL path reliably using wslpath command
    $wslPathCommand = "wsl.exe --exec wslpath '$dotfilesDir'"
    $wslDotfilesPath = Invoke-Expression $wslPathCommand

    # Add error handling
    if (-not $wslDotfilesPath) {
        Write-Host "Failed to convert Windows path to WSL path. Using fallback method..." -ForegroundColor Yellow
        # Fallback: Simple replacement conversion
        $wslDotfilesPath = "/mnt/c" + $dotfilesDir.Replace("\", "/").Replace("C:", "")
    }
    
    # Create the command to run in WSL with improved error handling
    $setupCommand = @"
#!/bin/bash
set -e
echo "Setting up dotfiles in WSL..."
if [ ! -d "$wslDotfilesPath" ]; then
    echo "Error: Dotfiles directory not found at $wslDotfilesPath"
    exit 1
fi

mkdir -p ~/dotfiles
echo "Copying files from $wslDotfilesPath to ~/dotfiles/"
cp -r "$wslDotfilesPath"/* ~/dotfiles/ || { echo "Copy failed"; exit 1; }
cd ~/dotfiles
chmod +x install.sh
./install.sh
echo "Dotfiles setup in WSL complete!"
"@
    
    # Save the setup command to a temporary file
    $setupScriptPath = "$env:TEMP\wsl-setup.sh"
    $setupCommand | Out-File -FilePath $setupScriptPath -Encoding utf8 -Force
    
    # Convert line endings to Unix format
    $content = [System.IO.File]::ReadAllText($setupScriptPath)
    [System.IO.File]::WriteAllText($setupScriptPath, $content.Replace("`r`n", "`n"))
    
    # Run the setup script in WSL
    Write-Host "Running dotfiles setup in WSL. This may take some time..."
    wsl -d $wslDistro -e bash -c "cat /mnt/c$(($setupScriptPath).Replace('\', '/').Replace('C:', '')) | bash"
    
    # Clean up
    Remove-Item -Path $setupScriptPath -Force
    
    Write-Host "Dotfiles setup in WSL complete!"
}

# Function to install Visual Studio Code extensions
function Install-VSCodeExtensions {
    Write-Host "Installing Visual Studio Code extensions..."
    
    # Use dedicated installation script (more stable installation)
    try {
        # Call script from the same directory
        $extensionsScript = Join-Path $PSScriptRoot "install-vscode-extensions.ps1"
        if (Test-Path $extensionsScript) {
            Write-Host "Running dedicated VS Code extensions installation script..." -ForegroundColor Cyan
            & $extensionsScript
            return
        }
    } catch {
        Write-Host "Failed to run dedicated extensions script. Falling back to built-in method." -ForegroundColor Yellow
    }
    
    # Fallback: Install extensions using built-in method
    # Check if VSCode is installed
    if (-not (Test-Command code)) {
        Write-Host "Visual Studio Code not found in PATH. Extensions will not be installed."
        return
    }
    
    # Create temporary file
    $tempExtFile = "$env:TEMP\vscode_extensions_temp.txt"
    
    # Path to extensions file - make sure we're using Windows path format
    $extensionsFile = "$dotfilesDir\config\vscode\extensions.txt"
    
    if (Test-Path $extensionsFile) {
        # Copy content to temporary file
        Copy-Item -Path $extensionsFile -Destination $tempExtFile -Force
        
        if (Test-Path $tempExtFile) {
            $extensions = Get-Content -Path $tempExtFile
            
            # Execute commands in PowerShell process (regardless of current directory)
            $currentDir = Get-Location
            Set-Location $env:USERPROFILE
            
            foreach ($extension in $extensions) {
                if ([string]::IsNullOrWhiteSpace($extension)) { continue }
                
                Write-Host "Installing extension: $extension"
                try {
                    # Build command with parameters specified separately
                    $process = Start-Process -FilePath "code" -ArgumentList "--install-extension", "$extension", "--force" -NoNewWindow -Wait -PassThru
                    
                    if ($process.ExitCode -eq 0) {
                        Write-Host "Successfully installed extension: $extension" -ForegroundColor Green
                    } else {
                        Write-Host "Failed to install extension: $extension (Exit code: $($process.ExitCode))" -ForegroundColor Yellow
                    }
                }
                catch {
                    # Store exception object in temporary variable before referencing (WSL path issue workaround)
                    $errorMessage = ""
                    try {
                        $errorMessage = $_.Exception.Message
                    } catch {
                        $errorMessage = "Unknown error"
                    }
                    # Build error message with format string (WSL path compatible)
                    $message = "Error installing extension {0}: {1}" -f $extension, $errorMessage
                    Write-Host $message -ForegroundColor Red
                }
            }
            
            # Return to original directory
            Set-Location $currentDir
            
            # Remove temporary file
            Remove-Item -Path $tempExtFile -Force
            
            Write-Host "VS Code extensions installation completed."
        } else {
            Write-Host "Failed to create temporary extensions file" -ForegroundColor Red
        }
    } else {
        Write-Host "Extensions file not found: $extensionsFile" -ForegroundColor Red
    }
}

# Function to install Cursor extensions
function Install-CursorExtensions {
    Write-Host "Installing Cursor extensions..."
    
    # Use dedicated installation script (more stable installation)
    try {
        # Call script from the same directory
        $extensionsScript = Join-Path $PSScriptRoot "install-vscode-extensions.ps1"
        if (Test-Path $extensionsScript) {
            Write-Host "Running dedicated Cursor extensions installation script..." -ForegroundColor Cyan
            # Add parameter to install only Cursor extensions
            & $extensionsScript -CursorOnly
            return
        }
    } catch {
        Write-Host "Failed to run dedicated extensions script. Falling back to built-in method." -ForegroundColor Yellow
    }
    
    # Fallback: Install extensions using built-in method
    # Check if Cursor is installed and cursor command is available
    if (-not (Test-Command cursor)) {
        Write-Host "Cursor not found in PATH. Extensions will not be installed."
        return
    }
    
    # Create temporary file
    $tempExtFile = "$env:TEMP\cursor_extensions_temp.txt"
    
    # Path to extensions file - use same file as VSCode
    $extensionsFile = "$dotfilesDir\config\vscode\extensions.txt"
    
    if (Test-Path $extensionsFile) {
        # Copy content to temporary file
        Copy-Item -Path $extensionsFile -Destination $tempExtFile -Force
        
        if (Test-Path $tempExtFile) {
            $extensions = Get-Content -Path $tempExtFile
            
            # Execute commands in PowerShell process (regardless of current directory)
            $currentDir = Get-Location
            Set-Location $env:USERPROFILE
            
            foreach ($extension in $extensions) {
                if ([string]::IsNullOrWhiteSpace($extension)) { continue }
                
                Write-Host "Installing Cursor extension: $extension"
                try {
                    # Build command with parameters specified separately
                    $process = Start-Process -FilePath "cursor" -ArgumentList "--install-extension", "$extension", "--force" -NoNewWindow -Wait -PassThru
                    
                    if ($process.ExitCode -eq 0) {
                        Write-Host "Successfully installed Cursor extension: $extension" -ForegroundColor Green
                    } else {
                        Write-Host "Failed to install Cursor extension: $extension (Exit code: $($process.ExitCode))" -ForegroundColor Yellow
                    }
                }
                catch {
                    # Store exception object in temporary variable before referencing (WSL path issue workaround)
                    $errorMessage = ""
                    try {
                        $errorMessage = $_.Exception.Message
                    } catch {
                        $errorMessage = "Unknown error"
                    }
                    # Build error message with format string (WSL path compatible)
                    $message = "Error installing Cursor extension {0}: {1}" -f $extension, $errorMessage
                    Write-Host $message -ForegroundColor Red
                }
            }
            
            # Return to original directory
            Set-Location $currentDir
            
            # Remove temporary file
            Remove-Item -Path $tempExtFile -Force
            
            Write-Host "Cursor extensions installation completed."
        } else {
            Write-Host "Failed to create temporary extensions file" -ForegroundColor Red
        }
    } else {
        Write-Host "Extensions file not found: $extensionsFile" -ForegroundColor Red
    }
}

# Main installation function
function Install-Dotfiles {
    Write-Host "=============================================="
    Write-Host "      Windows Dotfiles Installation Script   "
    Write-Host "=============================================="
    Write-Host ""
    
    # Initial setup - check prerequisites
    Write-Host "Checking prerequisites..."
    
    # Ensure we're on Windows 10/11
    $osInfo = Get-CimInstance -ClassName Win32_OperatingSystem
    $osVersion = [System.Version]($osInfo.Version)
    
    if ($osVersion.Major -lt 10) {
        Write-Error "This script requires Windows 10 or newer."
        exit 1
    }
    
    # Install WSL if not already installed
    $wslInstalled = Install-WSL
    
    if (-not $wslInstalled) {
        Write-Error "Failed to install WSL. Please try again or install it manually."
        exit 1
    }
    
    # Prompt user for actions
    Write-Host ""
    Write-Host "The following operations will be performed:"
    Write-Host "1. Install development fonts (JetBrains Mono, Hack Nerd Font)"
    Write-Host "2. Install Windows development tools (VS Code, Windows Terminal, Git, Ueli, DevToys, etc.)"
    Write-Host "3. Configure Windows Terminal"
    Write-Host "4. Install VS Code extensions"
    Write-Host "5. Set up dotfiles in WSL environment"
    Write-Host ""
    
    $confirmation = Read-Host "Do you want to continue? (y/N)"
    if ($confirmation -ne 'y' -and $confirmation -ne 'Y') {
        Write-Host "Installation cancelled."
        exit 0
    }
    
    # Perform installation
    Install-DevFonts
    Install-DevTools
    Configure-WindowsTerminal
    Install-VSCodeExtensions
    Install-CursorExtensions
    Setup-WslDotfiles
    
    Write-Host ""
    Write-Host "=============================================="
    Write-Host "       Dotfiles Installation Complete        "
    Write-Host "=============================================="
    Write-Host ""
    Write-Host "Your Windows environment and WSL development setup are now complete."
    Write-Host ""
    Write-Host "Next steps:"
    Write-Host "- Open Windows Terminal to access your WSL environment"
    Write-Host "- Start working with your freshly configured dev environment!"
    Write-Host ""
    Write-Host "Note: Some settings may require an application restart or system reboot to take effect."
}

# Run the installation
Install-Dotfiles