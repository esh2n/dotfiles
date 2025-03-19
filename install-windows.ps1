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
    
    # Check if Ubuntu is already installed
    $ubuntuCheck = wsl -l | Select-String "Ubuntu"
    if ($ubuntuCheck) {
        Write-Host "Ubuntu is already installed."
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
    
    $repoPath = Split-Path -Parent $MyInvocation.MyCommand.Path
    $repoName = Split-Path -Leaf $repoPath
    
    # Create the WSL path to the dotfiles repository
    $wslPath = "/mnt/c" + $repoPath.Substring(2).Replace("\", "/")
    
    # Run commands in WSL
    Write-Host "Running dotfiles install script in WSL..."
    wsl -d Ubuntu bash -c "cd '$wslPath' && ./install.sh"
}

# Setup Windows native configurations
function Setup-WindowsNativeConfig {
    Write-Host "Setting up Windows native configurations..." -ForegroundColor Cyan
    
    $repoPath = Split-Path -Parent $MyInvocation.MyCommand.Path
    
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
    Copy-Item -Path "$repoPath\config\wezterm\*" -Destination $weztermDir -Recurse -Force
    Write-Host "Configured WezTerm for Windows"
    
    # Neovim configuration
    $nvimDir = "$configDir\nvim"
    if (-not (Test-Path $nvimDir)) {
        New-Item -Path $nvimDir -ItemType Directory -Force | Out-Null
    }
    Copy-Item -Path "$repoPath\config\nvim\*" -Destination $nvimDir -Recurse -Force
    Write-Host "Configured Neovim for Windows"
    
    # Starship configuration
    Copy-Item -Path "$repoPath\config\starship\starship.toml" -Destination "$configDir\starship.toml" -Force
    Write-Host "Configured Starship for Windows"
    
    # Git configuration
    Copy-Item -Path "$repoPath\git\.gitconfig" -Destination "$env:USERPROFILE\.gitconfig" -Force
    
    $gitConfigDir = "$configDir\git"
    if (-not (Test-Path $gitConfigDir)) {
        New-Item -Path $gitConfigDir -ItemType Directory -Force | Out-Null
    }
    Copy-Item -Path "$repoPath\git\.gitignore_global" -Destination "$gitConfigDir\ignore" -Force
    Copy-Item -Path "$repoPath\git\.gitmessage" -Destination "$gitConfigDir\message" -Force
    Copy-Item -Path "$repoPath\git\.gitmessage.emoji" -Destination "$gitConfigDir\message.emoji" -Force
    Copy-Item -Path "$repoPath\git\config.local" -Destination "$gitConfigDir\config.local" -Force
    Copy-Item -Path "$repoPath\git\config.sub" -Destination "$gitConfigDir\config.sub" -Force
    Write-Host "Configured Git for Windows"
    
    # VSCode/Cursor config if installed
    $vscodePath = "$env:APPDATA\Code\User"
    if (Test-Path $vscodePath) {
        Copy-Item -Path "$repoPath\config\vscode\settings.json" -Destination "$vscodePath\settings.json" -Force
        Write-Host "Configured VSCode for Windows"
    }
    
    $cursorPath = "$env:APPDATA\Cursor\User"
    if (Test-Path $cursorPath) {
        Copy-Item -Path "$repoPath\config\vscode\settings.json" -Destination "$cursorPath\settings.json" -Force
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