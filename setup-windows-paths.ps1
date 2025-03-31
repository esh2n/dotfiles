# Windows Environment Configuration Setup Script
# This script places configuration files from the WSL dotfiles repository to the Windows side
# It is recommended to run with administrator privileges
#
# How to run:
# 1. Directly from Windows PowerShell (recommended): .\setup-windows-paths.ps1
# 2. From WSL calling Windows PowerShell: powershell.exe -ExecutionPolicy Bypass -File "$PWD/setup-windows-paths.ps1"
# 3. From PowerShell Core (pwsh) in WSL: pwsh -File ./setup-windows-paths.ps1
#
# Note: This script is saved in UTF-8 encoding.
# If running from WSL, it is strongly recommended to run directly from Windows PowerShell
# to avoid encoding issues.

# Determine if running in WSL environment
$isRunningInWSL = $false
try {
    # In WSL environment, $env:WSL_DISTRO is defined or /proc/version contains specific strings
    if ($env:WSL_DISTRO -or (Test-Path "/proc/version")) {
        if (Test-Path "/proc/version") {
            $procVersion = Get-Content "/proc/version" -ErrorAction SilentlyContinue
            if ($procVersion -match "Microsoft|WSL") {
                $isRunningInWSL = $true
                Write-Host "Detected running in WSL environment" -ForegroundColor Cyan
            }
        } else {
            $isRunningInWSL = $true
            Write-Host "Detected WSL environment variables" -ForegroundColor Cyan
        }
    }
} catch {
    # If an error occurs, assume not running in WSL
    $isRunningInWSL = $false
}

# Get script path and determine dotfiles directory
$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
$dotfilesDir = $scriptPath

# Perform path conversion if running from WSL environment
if ($isRunningInWSL) {
    try {
        # Determine Windows user profile path from WSL path
        $winUserProfile = [System.Environment]::GetFolderPath('UserProfile')
        
        if (-not $winUserProfile) {
            # Backup plan: Determine Windows user profile from WSL
            $winUserProfile = "$env:USERPROFILE"
            if (-not $winUserProfile) {
                # Additional backup: Guess typical Windows path
                if ($env:USERNAME) {
                    $winUserProfile = "C:\Users\$env:USERNAME"
                } else {
                    Write-Host "Warning: Could not determine Windows user profile path." -ForegroundColor Yellow
                    Write-Host "Using C:\Users\[username]. Please place configurations manually if needed." -ForegroundColor Yellow
                    $winUserProfile = "C:\Users\$env:USER"
                }
            }
        }
        
        # Display additional information if script is running from WSL
        Write-Host "Running from WSL environment. Windows user profile path: $winUserProfile" -ForegroundColor Cyan
    } catch {
        Write-Host "Error during WSL path conversion: $_" -ForegroundColor Red
    }
}

# Backup function
function Backup-Config {
    param (
        [string]$Path
    )
    
    if (Test-Path $Path) {
        $backupDir = Join-Path $env:USERPROFILE ".dotfiles_backup\$(Get-Date -Format 'yyyyMMdd_HHmmss')"
        if (-not (Test-Path $backupDir)) {
            New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
        }
        
        $fileName = Split-Path -Leaf $Path
        $backupPath = Join-Path $backupDir $fileName
        
        Write-Host "Creating backup: $Path -> $backupPath"
        Copy-Item -Path $Path -Destination $backupPath -Force -Recurse
    }
}

# Function to create directory if it doesn't exist
function Ensure-Directory {
    param (
        [string]$Path
    )
    
    if (-not (Test-Path $Path)) {
        Write-Host "Creating directory: $Path"
        New-Item -ItemType Directory -Path $Path -Force | Out-Null
    }
}

# Display configuration selection menu
function Show-Menu {
    Write-Host "`n==== Windows Environment Configuration Setup ====" -ForegroundColor Cyan
    Write-Host "This script places configuration files from WSL dotfiles to the Windows side" -ForegroundColor Yellow
    Write-Host "Select which configurations to install:" -ForegroundColor Yellow
    Write-Host "1. Install all configurations"
    Write-Host "2. Install WezTerm configuration only"
    Write-Host "3. Install VSCode configuration only"
    Write-Host "4. Install Cursor configuration only"
    Write-Host "5. Install Starship configuration only"
    Write-Host "0. Exit"
    
    $choice = Read-Host "Please select (0-5)"
    return $choice
}

# Copy WezTerm configuration
function Install-WezTermConfig {
    Write-Host "`n==== Installing WezTerm Configuration ====" -ForegroundColor Green
    
    # Configuration file path
    $weztermConfigDir = Join-Path $env:USERPROFILE ".config\wezterm"
    Ensure-Directory $weztermConfigDir
    
    # Create backup
    Backup-Config $weztermConfigDir
    
    # Copy WezTerm configuration from dotfiles
    $sourceWeztermDir = Join-Path $dotfilesDir "config\wezterm"
    
    # Copy main configuration file
    Write-Host "Copying WezTerm configuration file..."
    Copy-Item -Path (Join-Path $sourceWeztermDir "wezterm.lua") -Destination $weztermConfigDir -Force
    
    # Copy subdirectories
    $subDirs = @("lua", "lua\core", "lua\ui", "lua\utils")
    foreach ($subDir in $subDirs) {
        $targetDir = Join-Path $weztermConfigDir $subDir
        Ensure-Directory $targetDir
        
        # Copy Lua files in subdirectories
        $sourceDir = Join-Path $sourceWeztermDir $subDir
        if (Test-Path $sourceDir) {
            Get-ChildItem -Path $sourceDir -Filter "*.lua" | ForEach-Object {
                $targetFile = Join-Path $targetDir $_.Name
                Write-Host "Copying: $($_.FullName) -> $targetFile"
                Copy-Item -Path $_.FullName -Destination $targetFile -Force
            }
        }
    }
    
    Write-Host "WezTerm configuration installation completed" -ForegroundColor Green
}

# Copy VSCode configuration
function Install-VSCodeConfig {
    Write-Host "`n==== Installing VSCode Configuration ====" -ForegroundColor Green
    
    # VSCode configuration directories (check multiple possibilities)
    $possiblePaths = @(
        (Join-Path $env:APPDATA "Code\User"),
        (Join-Path $env:LOCALAPPDATA "Code\User"),
        (Join-Path $env:USERPROFILE ".vscode")
    )
    
    $installed = $false
    
    foreach ($vscodePath in $possiblePaths) {
        if (Test-Path (Split-Path -Parent $vscodePath)) {
            Ensure-Directory $vscodePath
            
            # Configuration file path
            $settingsPath = Join-Path $vscodePath "settings.json"
            
            # Create backup
            Backup-Config $settingsPath
            
            # Copy configuration file
            $sourceSettingsPath = Join-Path $dotfilesDir "config\vscode\settings.json"
            Write-Host "Copying VSCode configuration file: $sourceSettingsPath -> $settingsPath"
            Copy-Item -Path $sourceSettingsPath -Destination $settingsPath -Force
            
            $installed = $true
            Write-Host "VSCode configuration file installed to $vscodePath" -ForegroundColor Green
        }
    }
    
    if (-not $installed) {
        Write-Host "VSCode configuration directory not found. Please check if VSCode is installed." -ForegroundColor Yellow
    }
}

# Copy Cursor configuration
function Install-CursorConfig {
    Write-Host "`n==== Installing Cursor Configuration ====" -ForegroundColor Green
    
    # Cursor configuration directories (check multiple possibilities)
    $possiblePaths = @(
        (Join-Path $env:USERPROFILE ".cursor\User"),
        (Join-Path $env:APPDATA "Cursor\User"),
        (Join-Path $env:LOCALAPPDATA "Cursor\User")
    )
    
    $installed = $false
    
    foreach ($cursorPath in $possiblePaths) {
        if (Test-Path (Split-Path -Parent (Split-Path -Parent $cursorPath))) {
            Ensure-Directory $cursorPath
            
            # Configuration file paths
            $settingsPath = Join-Path $cursorPath "settings.json"
            $mcpPath = Join-Path $cursorPath "mcp.json"
            
            # Create backups
            Backup-Config $settingsPath
            Backup-Config $mcpPath
            
            # Copy configuration files
            $sourceSettingsPath = Join-Path $dotfilesDir "config\vscode\settings.json"
            $sourceMcpPath = Join-Path $dotfilesDir "config\cursor\mcp.json"
            
            Write-Host "Copying Cursor configuration file: $sourceSettingsPath -> $settingsPath"
            Copy-Item -Path $sourceSettingsPath -Destination $settingsPath -Force
            
            Write-Host "Copying Cursor MCP configuration file: $sourceMcpPath -> $mcpPath"
            Copy-Item -Path $sourceMcpPath -Destination $mcpPath -Force
            
            $installed = $true
            Write-Host "Cursor configuration files installed to $cursorPath" -ForegroundColor Green
        }
    }
    
    if (-not $installed) {
        Write-Host "Cursor configuration directory not found. Please check if Cursor is installed." -ForegroundColor Yellow
    }
}

# Copy Starship configuration
function Install-StarshipConfig {
    Write-Host "`n==== Installing Starship Configuration ====" -ForegroundColor Green
    
    # Starship configuration directory
    $starshipConfigDir = Join-Path $env:USERPROFILE ".config"
    Ensure-Directory $starshipConfigDir
    
    # Configuration file path
    $starshipConfigPath = Join-Path $starshipConfigDir "starship.toml"
    
    # Create backup
    Backup-Config $starshipConfigPath
    
    # Copy configuration file
    $sourceStarshipPath = Join-Path $dotfilesDir "config\starship\starship.toml"
    Write-Host "Copying Starship configuration file: $sourceStarshipPath -> $starshipConfigPath"
    Copy-Item -Path $sourceStarshipPath -Destination $starshipConfigPath -Force
    
    Write-Host "Starship configuration file installed" -ForegroundColor Green
}

# Main processing
function Main {
    Write-Host "Starting Windows dotfiles configuration script..." -ForegroundColor Cyan
    
    $choice = Show-Menu
    
    switch ($choice) {
        "0" {
            Write-Host "Exiting script" -ForegroundColor Yellow
            return
        }
        "1" {
            Install-WezTermConfig
            Install-VSCodeConfig
            Install-CursorConfig
            Install-StarshipConfig
            
            Write-Host "`n==== All configurations have been installed ====" -ForegroundColor Green
        }
        "2" {
            Install-WezTermConfig
        }
        "3" {
            Install-VSCodeConfig
        }
        "4" {
            Install-CursorConfig
        }
        "5" {
            Install-StarshipConfig
        }
        default {
            Write-Host "Invalid selection. Exiting script." -ForegroundColor Red
            return
        }
    }
    
    Write-Host "`nConfiguration file installation completed" -ForegroundColor Cyan
    Write-Host "Backups are saved in $env:USERPROFILE\.dotfiles_backup" -ForegroundColor Cyan
}

# Execute script
Main