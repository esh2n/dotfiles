#Requires -RunAsAdministrator
# Cross-platform dotfiles installer for Windows
# This script will:
# 1. Install WSL2 and Ubuntu
# 2. Install essential Windows developer tools
# 3. Setup fonts and configurations

# Stop on first error
$ErrorActionPreference = "Stop"

# Display banner
Write-Host "=========================================================" -ForegroundColor Cyan
Write-Host "         Cross-Platform Dotfiles - Windows Setup         " -ForegroundColor Cyan
Write-Host "=========================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "This script will set up your Windows environment with:"
Write-Host "- WSL2 with Ubuntu"
Write-Host "- Development tools (Git, VS Code, Windows Terminal)"
Write-Host "- Programming fonts"
Write-Host "- Configuration files"
Write-Host ""
Write-Host "After this script completes, you'll need to run the install.sh"
Write-Host "script inside WSL to complete the setup."
Write-Host ""

# Confirm execution
$confirmation = Read-Host "Do you want to continue? (y/N)"
if ($confirmation -ne "y" -and $confirmation -ne "Y") {
    Write-Host "Installation cancelled." -ForegroundColor Yellow
    exit 1
}

# Get script directory
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# Check if running as administrator
if (-not ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "Error: This script must be run as Administrator" -ForegroundColor Red
    Write-Host "Please restart PowerShell as Administrator and try again." -ForegroundColor Yellow
    exit 1
}

# Function to check if command exists
function Test-CommandExists {
    param ($command)
    $oldPreference = $ErrorActionPreference
    $ErrorActionPreference = 'stop'
    try {
        if (Get-Command $command) { return $true }
    } catch {
        return $false
    } finally {
        $ErrorActionPreference = $oldPreference
    }
}

# Function to check if WSL is installed
function Test-WSLInstalled {
    $wsl = Get-WindowsOptionalFeature -Online -FeatureName Microsoft-Windows-Subsystem-Linux
    return $wsl.State -eq "Enabled"
}

# Function to check if VirtualMachinePlatform is installed
function Test-VMPlatformInstalled {
    $vmp = Get-WindowsOptionalFeature -Online -FeatureName VirtualMachinePlatform
    return $vmp.State -eq "Enabled"
}

# Function to check if WSL2 is set as default
function Test-WSL2Default {
    $wslVersion = wsl --status | Select-String "Default Version"
    return $wslVersion -match "2"
}

# Function to check if Ubuntu is installed
function Test-UbuntuInstalled {
    $distributions = wsl --list
    return $distributions -match "Ubuntu"
}

# Install WSL
function Install-WSL {
    Write-Host "Installing Windows Subsystem for Linux..." -ForegroundColor Cyan
    
    if (-not (Test-WSLInstalled)) {
        Write-Host "Enabling WSL feature..." -ForegroundColor Yellow
        Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Windows-Subsystem-Linux -NoRestart
        Write-Host "WSL feature enabled." -ForegroundColor Green
    } else {
        Write-Host "WSL feature is already enabled." -ForegroundColor Green
    }
    
    if (-not (Test-VMPlatformInstalled)) {
        Write-Host "Enabling Virtual Machine Platform feature..." -ForegroundColor Yellow
        Enable-WindowsOptionalFeature -Online -FeatureName VirtualMachinePlatform -NoRestart
        Write-Host "Virtual Machine Platform feature enabled." -ForegroundColor Green
        
        Write-Host "A system restart may be required to complete WSL installation." -ForegroundColor Yellow
        $restart = Read-Host "Would you like to restart now? (y/N)"
        if ($restart -eq "y" -or $restart -eq "Y") {
            Restart-Computer
            exit
        } else {
            Write-Host "Please restart your computer before continuing with the installation." -ForegroundColor Yellow
            exit
        }
    } else {
        Write-Host "Virtual Machine Platform feature is already enabled." -ForegroundColor Green
    }
    
    # Set WSL2 as default
    if (-not (Test-WSL2Default)) {
        Write-Host "Setting WSL2 as default version..." -ForegroundColor Yellow
        wsl --set-default-version 2
        Write-Host "WSL2 set as default." -ForegroundColor Green
    } else {
        Write-Host "WSL2 is already set as default." -ForegroundColor Green
    }
}

# Install Ubuntu
function Install-Ubuntu {
    Write-Host "Installing Ubuntu on WSL..." -ForegroundColor Cyan
    
    if (-not (Test-UbuntuInstalled)) {
        Write-Host "Installing Ubuntu from Microsoft Store..." -ForegroundColor Yellow
        # Use wsl --install -d Ubuntu which is the modern way to install Ubuntu on WSL
        wsl --install -d Ubuntu
        
        Write-Host "Ubuntu installed. Please complete the setup by:" -ForegroundColor Green
        Write-Host "1. Wait for Ubuntu to start and create your user account when prompted" -ForegroundColor Yellow
        Write-Host "2. After setup, run the following commands in Ubuntu:" -ForegroundColor Yellow
        Write-Host "   cd ~ && git clone https://github.com/esh2n/dotfiles.git && cd dotfiles && ./install.sh" -ForegroundColor White
    } else {
        Write-Host "Ubuntu is already installed." -ForegroundColor Green
    }
}

# Install Chocolatey
function Install-Chocolatey {
    Write-Host "Installing Chocolatey package manager..." -ForegroundColor Cyan
    
    if (-not (Test-CommandExists choco)) {
        Write-Host "Installing Chocolatey..." -ForegroundColor Yellow
        Set-ExecutionPolicy Bypass -Scope Process -Force
        [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
        Invoke-Expression ((New-Object System.Net.WebClient).DownloadString('https://chocolatey.org/install.ps1'))
        
        # Refresh environment to include choco in PATH
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
        
        Write-Host "Chocolatey installed." -ForegroundColor Green
    } else {
        Write-Host "Chocolatey is already installed." -ForegroundColor Green
    }
}

# Install Windows developer tools
function Install-DeveloperTools {
    Write-Host "Installing Windows developer tools..." -ForegroundColor Cyan
    
    # Install Git, VS Code, Windows Terminal, etc.
    $packages = @(
        "git",
        "vscode",
        "microsoft-windows-terminal",
        "powershell-core",
        "firacode",
        "cascadiacode",
        "nodejs-lts",
        "python",
        "7zip"
    )
    
    foreach ($package in $packages) {
        Write-Host "Installing $package..." -ForegroundColor Yellow
        choco install $package -y
    }
    
    Write-Host "Developer tools installed." -ForegroundColor Green
}

# Configure Windows Terminal
function Configure-WindowsTerminal {
    Write-Host "Configuring Windows Terminal..." -ForegroundColor Cyan
    
    $terminalSettingsPath = "$env:LOCALAPPDATA\Packages\Microsoft.WindowsTerminal_8wekyb3d8bbwe\LocalState\settings.json"
    
    # Check if Windows Terminal settings directory exists
    if (-not (Test-Path (Split-Path -Parent $terminalSettingsPath))) {
        Write-Host "Windows Terminal settings directory not found. Skipping configuration." -ForegroundColor Yellow
        return
    }
    
    # Backup existing settings if they exist
    if (Test-Path $terminalSettingsPath) {
        $backupPath = "$env:LOCALAPPDATA\Packages\Microsoft.WindowsTerminal_8wekyb3d8bbwe\LocalState\settings.backup.json"
        Copy-Item -Path $terminalSettingsPath -Destination $backupPath -Force
        Write-Host "Backed up existing Windows Terminal settings to $backupPath" -ForegroundColor Green
    }
    
    # Create new settings file
    $terminalSettings = @{
        "$schema" = "https://aka.ms/terminal-profiles-schema"
        "defaultProfile" = "{2c4de342-38b7-51cf-b940-2309a097f518}" # Ubuntu
        "profiles" = @{
            "defaults" = @{
                "fontFace" = "CascadiaCode"
                "fontSize" = 12
                "colorScheme" = "One Half Dark"
                "cursorShape" = "filledBox"
                "useAcrylic" = $true
                "acrylicOpacity" = 0.8
            }
            "list" = @()
        }
        "schemes" = @()
        "keybindings" = @()
    }
    
    # Convert to JSON and save
    $terminalSettings | ConvertTo-Json -Depth 10 | Set-Content $terminalSettingsPath
    
    Write-Host "Windows Terminal configured." -ForegroundColor Green
}

# Setup Git
function Configure-Git {
    Write-Host "Configuring Git..." -ForegroundColor Cyan
    
    # Set Git defaults
    git config --global core.editor "code --wait"
    git config --global init.defaultBranch main
    
    # Ask for Git user information
    $gitName = Read-Host "Enter your Git user name"
    $gitEmail = Read-Host "Enter your Git email address"
    
    if ($gitName -and $gitEmail) {
        git config --global user.name $gitName
        git config --global user.email $gitEmail
        Write-Host "Git configured with name: $gitName and email: $gitEmail" -ForegroundColor Green
    } else {
        Write-Host "Skipping Git user configuration." -ForegroundColor Yellow
    }
}

# Main installation process
function Start-Installation {
    try {
        # Install Chocolatey first as we need it for other installations
        Install-Chocolatey
        
        # Install developer tools
        Install-DeveloperTools
        
        # Configure Git
        Configure-Git
        
        # Configure Windows Terminal
        Configure-WindowsTerminal
        
        # Install WSL2
        Install-WSL
        
        # Install Ubuntu
        Install-Ubuntu
        
        Write-Host ""
        Write-Host "=========================================================" -ForegroundColor Cyan
        Write-Host "                   Installation Complete                  " -ForegroundColor Cyan
        Write-Host "=========================================================" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "Next steps:" -ForegroundColor Yellow
        Write-Host "1. If prompted, restart your computer to complete WSL installation" -ForegroundColor White
        Write-Host "2. Start Ubuntu from the Start menu or by typing 'wsl' in PowerShell" -ForegroundColor White
        Write-Host "3. Complete the Ubuntu setup by creating a username and password" -ForegroundColor White
        Write-Host "4. In Ubuntu, run the following commands:" -ForegroundColor White
        Write-Host "   cd ~ && git clone https://github.com/esh2n/dotfiles.git && cd dotfiles && ./install.sh" -ForegroundColor Green
        Write-Host ""
        Write-Host "Note: Some changes might require a system restart to take effect." -ForegroundColor Yellow
        
    } catch {
        Write-Host "An error occurred during installation: $_" -ForegroundColor Red
        Write-Host "Installation failed. Please check the error message above." -ForegroundColor Red
    }
}

# Start the installation
Start-Installation