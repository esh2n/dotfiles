# VS Code and Cursor Extensions Installation Script
# This script installs VS Code and Cursor extensions from the extension list in the dotfiles repository
#
# Note: This script is saved in UTF-8 encoding.
# If running from WSL, it is strongly recommended to run directly from Windows PowerShell
# to avoid encoding issues.

param(
    [switch]$CursorOnly,    # Install only Cursor extensions
    [switch]$VSCodeOnly     # Install only VS Code extensions
)

# Get the directory where the script is located
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$extensionsFile = "$scriptDir\config\vscode\extensions.txt"

# Check for administrator privileges (not required but recommended)
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")
if (-not $isAdmin) {
    Write-Host "Note: Running without administrator privileges. Some extensions may fail to install." -ForegroundColor Yellow
}

# Function to check if a command exists
function Test-Command {
    param ($command)
    return (Get-Command $command -ErrorAction SilentlyContinue)
}

# Function to install extensions
function Install-Extensions {
    param (
        [string]$CommandName,
        [string]$DisplayName
    )
    
    if (-not (Test-Command $CommandName)) {
        Write-Host "$DisplayName not found. Extensions will not be installed." -ForegroundColor Red
        return $false
    }
    
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "Starting installation of $DisplayName extensions..." -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    
    # Create temporary file
    $tempExtFile = "$env:TEMP\${CommandName}_extensions_temp.txt"
    
    # Copy content to temporary file
    Copy-Item -Path $extensionsFile -Destination $tempExtFile -Force
    
    if (-not (Test-Path $tempExtFile)) {
        Write-Host "Failed to create temporary file: $tempExtFile" -ForegroundColor Red
        return $false
    }
    
    $extensions = Get-Content -Path $tempExtFile
    
    # Save current directory
    $currentDir = Get-Location
    # Move to user home directory (to avoid UNC path issues)
    Set-Location $env:USERPROFILE
    
    $successCount = 0
    $failCount = 0
    $startTime = Get-Date
    
    foreach ($extension in $extensions) {
        if ([string]::IsNullOrWhiteSpace($extension)) { continue }
        
        Write-Host "Installing: $extension" -NoNewline
        
        try {
            $process = Start-Process -FilePath $CommandName -ArgumentList "--install-extension", "$extension", "--force" -NoNewWindow -Wait -PassThru
            
            if ($process.ExitCode -eq 0) {
                Write-Host " [SUCCESS]" -ForegroundColor Green
                $successCount++
            } else {
                Write-Host " [FAILED] (Exit code: $($process.ExitCode))" -ForegroundColor Red
                $failCount++
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
            $message = " [ERROR] {0}" -f $errorMessage
            Write-Host $message -ForegroundColor Red
            $failCount++
        }
    }
    
    # Return to original directory
    Set-Location $currentDir
    
    # Remove temporary file
    Remove-Item -Path $tempExtFile -Force
    
    $endTime = Get-Date
    $duration = $endTime - $startTime
    
    Write-Host "----------------------------------------" -ForegroundColor Cyan
    Write-Host "$DisplayName extensions installation completed" -ForegroundColor Cyan
    Write-Host "Success: $successCount, Failed: $failCount" -ForegroundColor $(if ($failCount -eq 0) { "Green" } else { "Yellow" })
    Write-Host "Time taken: $($duration.Minutes)m $($duration.Seconds)s" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""
    
    return $true
}

# Main process
if (-not (Test-Path $extensionsFile)) {
    Write-Host "Extensions list file not found: $extensionsFile" -ForegroundColor Red
    exit 1
}

Write-Host "Loaded extensions list file: $extensionsFile" -ForegroundColor Green
$extensionCount = (Get-Content $extensionsFile | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Measure-Object).Count
Write-Host "Number of extensions to install: $extensionCount" -ForegroundColor Cyan
Write-Host ""

# Control installation process based on parameters
$vsCodeResult = $false
$cursorResult = $false

if (-not $CursorOnly) {
    # Install VS Code extensions
    $vsCodeResult = Install-Extensions -CommandName "code" -DisplayName "Visual Studio Code"
}

if (-not $VSCodeOnly) {
    # Install Cursor extensions
    $cursorResult = Install-Extensions -CommandName "cursor" -DisplayName "Cursor"
}

# Results summary
Write-Host "========================================" -ForegroundColor Green
Write-Host "Extensions Installation Complete" -ForegroundColor Green
Write-Host "----------------------------------------" -ForegroundColor Green

if ($vsCodeResult) {
    Write-Host "VS Code: Installation completed" -ForegroundColor Green
} else {
    Write-Host "VS Code: Installation skipped (not installed or not in PATH)" -ForegroundColor Yellow
}

if ($cursorResult) {
    Write-Host "Cursor: Installation completed" -ForegroundColor Green
} else {
    Write-Host "Cursor: Installation skipped (not installed or not in PATH)" -ForegroundColor Yellow
}

Write-Host "========================================" -ForegroundColor Green
Write-Host "If you need to reinstall extensions, run this script again." -ForegroundColor Cyan
Write-Host "If problems persist, refer to the 'Windows Extension Installation Troubleshooting' section in the README." -ForegroundColor Cyan