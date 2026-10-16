; MiniFX per-user installer (no admin rights needed).
; Used for local cross-builds; the GitHub Actions build uses Tauri's own NSIS template.
Unicode true
SetCompressor /SOLID lzma
RequestExecutionLevel user

!ifndef VERSION
  !define VERSION "0.1.0"
!endif
!ifndef SRC
  !define SRC "."
!endif
!define APP "MiniFX"
!define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP}"

Name "${APP} ${VERSION}"
OutFile "${OUTFILE}"
InstallDir "$LOCALAPPDATA\Programs\${APP}"
InstallDirRegKey HKCU "Software\${APP}" "InstallDir"
Icon "${SRC}\icon.ico"
UninstallIcon "${SRC}\icon.ico"
BrandingText "${APP} ${VERSION}"

!include "MUI2.nsh"
!define MUI_ICON "${SRC}\icon.ico"
!define MUI_UNICON "${SRC}\icon.ico"
!define MUI_FINISHPAGE_RUN "$INSTDIR\${APP}.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Launch ${APP}"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Function .onInit
  ; WebView2 runtime is built into Windows 11 and updated Windows 10.
  ReadRegStr $0 HKLM "SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "pv"
  StrCmp $0 "" 0 done
  ReadRegStr $0 HKCU "Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "pv"
  StrCmp $0 "" 0 done
  MessageBox MB_YESNO|MB_ICONINFORMATION "${APP} needs the Microsoft Edge WebView2 Runtime, which is not installed.$\r$\n$\r$\nOpen the download page now? (Install it, then run this setup again.)" IDNO done
  ExecShell "open" "https://go.microsoft.com/fwlink/p/?LinkId=2124703"
  Abort
  done:
FunctionEnd

Section "Install"
  ; Close any running (or stuck in the background) copy so its files can be replaced.
  nsExec::Exec 'taskkill /F /IM ${APP}.exe'
  Pop $0
  Sleep 800
  SetOutPath "$INSTDIR"
  File "${SRC}\${APP}.exe"
  File /nonfatal "${SRC}\WebView2Loader.dll"
  File "${SRC}\icon.ico"
  File "${SRC}\get-ffmpeg.ps1"
!ifdef BUNDLE_FFMPEG
  File "${SRC}\ffmpeg.exe"
  File "${SRC}\ffprobe.exe"
!else
  IfFileExists "$INSTDIR\ffmpeg.exe" ff_done
  DetailPrint "Downloading FFmpeg 7.1.1 (~90 MB), please wait..."
  nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\get-ffmpeg.ps1" -Dest "$INSTDIR"'
  Pop $0
  StrCmp $0 "0" ff_done
  MessageBox MB_OK|MB_ICONEXCLAMATION "FFmpeg could not be downloaded (check your internet connection).$\r$\n$\r$\nMiniFX will open, but import/export needs FFmpeg. To retry later, right-click get-ffmpeg.ps1 in the install folder and choose 'Run with PowerShell'."
  ff_done:
!endif
  WriteUninstaller "$INSTDIR\Uninstall.exe"

  CreateDirectory "$SMPROGRAMS\${APP}"
  CreateShortcut "$SMPROGRAMS\${APP}\${APP}.lnk" "$INSTDIR\${APP}.exe" "" "$INSTDIR\icon.ico"
  CreateShortcut "$SMPROGRAMS\${APP}\Uninstall ${APP}.lnk" "$INSTDIR\Uninstall.exe"
  CreateShortcut "$DESKTOP\${APP}.lnk" "$INSTDIR\${APP}.exe" "" "$INSTDIR\icon.ico"

  ; .msproj file association (per user)
  WriteRegStr HKCU "Software\Classes\.msproj" "" "MiniFX.Project"
  WriteRegStr HKCU "Software\Classes\MiniFX.Project" "" "MiniFX Project"
  WriteRegStr HKCU "Software\Classes\MiniFX.Project\DefaultIcon" "" "$INSTDIR\icon.ico"
  WriteRegStr HKCU "Software\Classes\MiniFX.Project\shell\open\command" "" '"$INSTDIR\${APP}.exe" "%1"'
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'

  WriteRegStr HKCU "Software\${APP}" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayName" "${APP}"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINST_KEY}" "Publisher" "MiniFX"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayIcon" "$INSTDIR\icon.ico"
  WriteRegStr HKCU "${UNINST_KEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoRepair" 1
SectionEnd

Section "Uninstall"
  nsExec::Exec 'taskkill /F /IM ${APP}.exe'
  Pop $0
  Sleep 800
  Delete "$INSTDIR\${APP}.exe"
  Delete "$INSTDIR\ffmpeg.exe"
  Delete "$INSTDIR\ffprobe.exe"
  Delete "$INSTDIR\WebView2Loader.dll"
  Delete "$INSTDIR\icon.ico"
  Delete "$INSTDIR\get-ffmpeg.ps1"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
  Delete "$SMPROGRAMS\${APP}\${APP}.lnk"
  Delete "$SMPROGRAMS\${APP}\Uninstall ${APP}.lnk"
  RMDir "$SMPROGRAMS\${APP}"
  Delete "$DESKTOP\${APP}.lnk"
  DeleteRegKey HKCU "Software\Classes\MiniFX.Project"
  DeleteRegValue HKCU "Software\Classes\.msproj" ""
  DeleteRegKey HKCU "${UNINST_KEY}"
  DeleteRegKey HKCU "Software\${APP}"
SectionEnd
