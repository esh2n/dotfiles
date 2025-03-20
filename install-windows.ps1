# Windows dotfiles installer script
# This script will install WSL2, setup Ubuntu, and configure dotfiles

# Run as administrator check
if (-NOT ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")) {
    Write-Warning "Please run this script as Administrator!"
    break
}

Write-Host "Windows dotfiles installer" -ForegroundColor Green
Write-Host "This script will:"
Write-Host "1. Install WSL2"
Write-Host "2. Install Ubuntu distribution"
Write-Host "3. Configure your dotfiles in WSL"
Write-Host "4. Configure your dotfiles in Windows native environment"
Write-Host ""

$continue = Read-Host "Do you want to continue? (y/N)"
if ($continue -ne "y" -and $continue -ne "Y") {
    Write-Host "Installation cancelled."
    exit
}

# Install WSL
function Install-WSL {
    Write-Host "Installing WSL2..." -ForegroundColor Cyan
    
    # Check if WSL is already installed
    $wslCheck = wsl --status 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "WSL is already installed."
    } else {
        Write-Host "Installing WSL..."
        try {
            # Enable WSL feature
            dism.exe /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /norestart
            
            # Enable Virtual Machine Platform
            dism.exe /online /enable-feature /featurename:VirtualMachinePlatform /all /norestart
            
            # Set WSL2 as default
            Write-Host "Downloading WSL2 kernel update..."
            $wslUpdateUrl = "https://wslstorestorage.blob.core.windows.net/wslblob/wsl_update_x64.msi"
            $wslUpdateFile = "$env:TEMP\wsl_update_x64.msi"
            Invoke-WebRequest -Uri $wslUpdateUrl -OutFile $wslUpdateFile
            Start-Process -FilePath $wslUpdateFile -ArgumentList "/quiet" -Wait
            
            # Set WSL2 as default
            wsl --set-default-version 2
            
            Write-Host "WSL2 installed successfully. System restart may be required." -ForegroundColor Green
            $restart = Read-Host "Do you want to restart now? (y/N)"
            if ($restart -eq "y" -or $restart -eq "Y") {
                Restart-Computer
                exit
            }
        } catch {
            Write-Error "Failed to install WSL: $_"
            exit
        }
    }
}

# Install Ubuntu
function Install-Ubuntu {
    Write-Host "Installing Ubuntu..." -ForegroundColor Cyan
    
    # Check if Ubuntu is already installed using more reliable method
    $ubuntuInstalled = $false
    
    # Try multiple methods to detect Ubuntu
    try {
        # Method 1: Direct distribution check
        $wslResult = wsl -l -v 2>&1
        Write-Host "WSL distributions:" -ForegroundColor Yellow
        $wslResult | ForEach-Object { Write-Host "  $_" -ForegroundColor Yellow }
        
        # Check if there's a line containing Ubuntu in the distribution list
        foreach ($line in $wslResult) {
            if ($line -match "Ubuntu") {
                $ubuntuInstalled = $true
                break
            }
        }
        
        # Method 2: Try running a command in Ubuntu as a fallback
        if (-not $ubuntuInstalled) {
            $testResult = wsl -d Ubuntu -- echo "Ubuntu test" 2>&1
            if ($LASTEXITCODE -eq 0) {
                $ubuntuInstalled = $true
                Write-Host "Ubuntu detected through command test." -ForegroundColor Yellow
            }
        }
    }
    catch {
        Write-Host "Error checking WSL distributions: $_" -ForegroundColor Yellow
        # Continue to installation if detection fails
    }
    
    if ($ubuntuInstalled) {
        Write-Host "Ubuntu is already installed." -ForegroundColor Green
    } else {
        try {
            # Install Ubuntu from Microsoft Store
            Write-Host "Installing Ubuntu from Microsoft Store..."
            Invoke-WebRequest -Uri "https://aka.ms/wslubuntu" -OutFile "Ubuntu.appx" -UseBasicParsing
            Add-AppxPackage .\Ubuntu.appx
            Remove-Item .\Ubuntu.appx
            
            # Launch Ubuntu to complete installation
            Write-Host "Launching Ubuntu for the first time."
            Write-Host "Please set up your username and password when prompted." -ForegroundColor Yellow
            Start-Process ubuntu
            
            # Wait for user to complete setup
            Read-Host "Press Enter after completing the Ubuntu setup..."
        } catch {
            Write-Error "Failed to install Ubuntu: $_"
            exit
        }
    }
}

# Setup dotfiles in WSL
function Setup-Dotfiles {
    Write-Host "Setting up dotfiles in WSL..." -ForegroundColor Cyan
    
    # Get the current script directory more reliably
    $scriptPath = $PSScriptRoot
    if (-not $scriptPath) {
        $scriptPath = Get-Location
        Write-Host "Using current directory: $scriptPath" -ForegroundColor Yellow
    }
    
    $repoName = Split-Path -Leaf $scriptPath
    
    # Create the WSL path to the dotfiles repository
    if ($scriptPath -match "^([A-Z]):(.*)$") {
        $driveLetter = $matches[1].ToLower()
        $restOfPath = $matches[2].Replace("\", "/")
        $wslPath = "/mnt/$driveLetter$restOfPath"
    } else {
        Write-Error "Cannot determine WSL path from: $scriptPath"
        return
    }
    
    # Run commands in WSL
    Write-Host "Running dotfiles install script in WSL..."
    Write-Host "WSL Path: $wslPath" -ForegroundColor Yellow
    wsl -d Ubuntu bash -c "cd '$wslPath' && ./install.sh"
}

# Setup Windows native configurations
function Setup-WindowsNativeConfig {
    Write-Host "Setting up Windows native configurations..." -ForegroundColor Cyan
    
    # Get the current script directory more reliably
    $scriptPath = $PSScriptRoot
    if (-not $scriptPath) {
        $scriptPath = Get-Location
        Write-Host "Using current directory: $scriptPath" -ForegroundColor Yellow
    }
    
    # Create .config directory if it doesn't exist
    $configDir = "$env:USERPROFILE\.config"
    if (-not (Test-Path $configDir)) {
        New-Item -Path $configDir -ItemType Directory -Force | Out-Null
        Write-Host "Created $configDir directory"
    }
    
    # WezTerm configuration
    $weztermDir = "$configDir\wezterm"
    if (-not (Test-Path $weztermDir)) {
        New-Item -Path $weztermDir -ItemType Directory -Force | Out-Null
    }
    $weztermSource = "$scriptPath\config\wezterm"
    if (Test-Path $weztermSource) {
        Copy-Item -Path "$weztermSource\*" -Destination $weztermDir -Recurse -Force
        Write-Host "Configured WezTerm for Windows"
    } else {
        Write-Host "WezTerm configuration source not found at: $weztermSource" -ForegroundColor Yellow
    }
    
    # Neovim configuration
    $nvimDir = "$configDir\nvim"
    if (-not (Test-Path $nvimDir)) {
        New-Item -Path $nvimDir -ItemType Directory -Force | Out-Null
    }
    $nvimSource = "$scriptPath\config\nvim"
    if (Test-Path $nvimSource) {
        Copy-Item -Path "$nvimSource\*" -Destination $nvimDir -Recurse -Force
        Write-Host "Configured Neovim for Windows"
    } else {
        Write-Host "Neovim configuration source not found at: $nvimSource" -ForegroundColor Yellow
    }
    
    # Starship configuration
    $starshipSource = "$scriptPath\config\starship\starship.toml"
    if (Test-Path $starshipSource) {
        Copy-Item -Path $starshipSource -Destination "$configDir\starship.toml" -Force
        Write-Host "Configured Starship for Windows"
    } else {
        Write-Host "Starship configuration source not found at: $starshipSource" -ForegroundColor Yellow
    }
    
    # Git configuration
    $gitConfigSource = "$scriptPath\git\.gitconfig"
    if (Test-Path $gitConfigSource) {
        Copy-Item -Path $gitConfigSource -Destination "$env:USERPROFILE\.gitconfig" -Force
    } else {
        Write-Host "Git configuration source not found at: $gitConfigSource" -ForegroundColor Yellow
    }
    
    $gitConfigDir = "$configDir\git"
    if (-not (Test-Path $gitConfigDir)) {
        New-Item -Path $gitConfigDir -ItemType Directory -Force | Out-Null
    }
    
    $gitFiles = @{
        "$scriptPath\git\.gitignore_global" = "$gitConfigDir\ignore";
        "$scriptPath\git\.gitmessage" = "$gitConfigDir\message";
        "$scriptPath\git\.gitmessage.emoji" = "$gitConfigDir\message.emoji";
        "$scriptPath\git\config.local" = "$gitConfigDir\config.local";
        "$scriptPath\git\config.sub" = "$gitConfigDir\config.sub"
    }
    
    $gitConfigSuccess = $true
    foreach ($source in $gitFiles.Keys) {
        $destination = $gitFiles[$source]
        if (Test-Path $source) {
            Copy-Item -Path $source -Destination $destination -Force
        } else {
            $gitConfigSuccess = $false
            Write-Host "Git file not found: $source" -ForegroundColor Yellow
        }
    }
    
    if ($gitConfigSuccess) {
        Write-Host "Configured Git for Windows"
    } else {
        Write-Host "Git configuration was partially completed" -ForegroundColor Yellow
    }
    
    # VSCode/Cursor config if installed
    $vscodeSettingsSource = "$scriptPath\config\vscode\settings.json"
    $vscodePath = "$env:APPDATA\Code\User"
    if ((Test-Path $vscodePath) -and (Test-Path $vscodeSettingsSource)) {
        Copy-Item -Path $vscodeSettingsSource -Destination "$vscodePath\settings.json" -Force
        Write-Host "Configured VSCode for Windows"
    }
    
    $cursorPath = "$env:APPDATA\Cursor\User"
    if ((Test-Path $cursorPath) -and (Test-Path $vscodeSettingsSource)) {
        Copy-Item -Path $vscodeSettingsSource -Destination "$cursorPath\settings.json" -Force
        Write-Host "Configured Cursor for Windows"
    }
}

# Main execution
Install-WSL
Install-Ubuntu
Setup-Dotfiles
Setup-WindowsNativeConfig

Write-Host "Windows dotfiles installation complete!" -ForegroundColor Green
Write-Host "Your dotfiles have been configured in WSL and Windows native environment."
Write-Host "You can now use your dotfiles environment by launching WSL Ubuntu or directly using Windows applications."