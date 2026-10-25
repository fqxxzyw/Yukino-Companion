Unicode true
!include "MUI2.nsh"
!include "LogicLib.nsh"
!ifndef PROJECT_ROOT
  !error "PROJECT_ROOT must point at the repository"
!endif
!ifndef SEVEN_ZIP
  !error "SEVEN_ZIP must point at the Windows 7za.exe"
!endif
Name "Yukino Companion"
OutFile "${PROJECT_ROOT}\release\Yukino-Companion-0.4.0-Setup.exe"
InstallDir "$LOCALAPPDATA\Programs\Yukino Companion"
InstallDirRegKey HKCU "Software\Yukino Companion" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma
ShowInstDetails show
Icon "${PROJECT_ROOT}\branding\app-icon.ico"
UninstallIcon "${PROJECT_ROOT}\branding\app-icon.ico"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TEXT "安装程序包含完整应用的校验清单。将所有 .zip.part 分卷放在安装器同目录即可离线安装主应用；缺少的分卷会显示进度并从本次发布下载。$\r$\n$\r$\n内置对话、翻译、默认音色和桌宠资源。首次启动可安装共享 Python 推理环境，也可以跳过。"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN "$INSTDIR\Yukino Companion.exe"
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"
!insertmacro MUI_LANGUAGE "English"
Section "Install"
  InitPluginsDir
  SetOutPath "$PLUGINSDIR"
  File /oname=7za.exe "${SEVEN_ZIP}"
  File /oname=install-app-payload.ps1 "${PROJECT_ROOT}\scripts\install-app-payload.ps1"
  File /oname=uninstall-app-payload.ps1 "${PROJECT_ROOT}\scripts\uninstall-app-payload.ps1"
  File /oname=app-payload.json "${PROJECT_ROOT}\release\app-payload.json"
  DetailPrint "正在准备完整应用。请在进度窗口中查看下载、校验和解压进度；可随时取消。"
  ExecWait '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "$PLUGINSDIR\install-app-payload.ps1" -Catalog "$PLUGINSDIR\app-payload.json" -SourceDirectory "$EXEDIR" -Target "$INSTDIR" -Extractor "$PLUGINSDIR\7za.exe"' $0
  ${If} $0 != 0
    DetailPrint "安装未完成（状态 $0）。现有配置未更改。"
    SetErrorLevel $0
    Abort
  ${EndIf}
  SetOutPath "$INSTDIR"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateShortcut "$DESKTOP\Yukino Companion.lnk" "$INSTDIR\Yukino Companion.exe"
  CreateDirectory "$SMPROGRAMS\Yukino Companion"
  CreateShortcut "$SMPROGRAMS\Yukino Companion\Yukino Companion.lnk" "$INSTDIR\Yukino Companion.exe"
  CreateShortcut "$SMPROGRAMS\Yukino Companion\卸载.lnk" "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "Software\Yukino Companion" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Yukino Companion" "DisplayName" "Yukino Companion"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Yukino Companion" "DisplayVersion" "0.4.0"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Yukino Companion" "UninstallString" '$"$INSTDIR\Uninstall.exe$"'
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Yukino Companion" "DisplayIcon" "$INSTDIR\Yukino Companion.exe"
SectionEnd
Section "Uninstall"
  InitPluginsDir
  SetOutPath "$PLUGINSDIR"
  File /oname=uninstall-app-payload.ps1 "${PROJECT_ROOT}\scripts\uninstall-app-payload.ps1"
  ExecWait '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "$PLUGINSDIR\uninstall-app-payload.ps1" -Target "$INSTDIR"' $0
  ${If} $0 != 0
    Abort
  ${EndIf}
  Delete "$DESKTOP\Yukino Companion.lnk"
  Delete "$SMPROGRAMS\Yukino Companion\Yukino Companion.lnk"
  Delete "$SMPROGRAMS\Yukino Companion\卸载.lnk"
  RMDir "$SMPROGRAMS\Yukino Companion"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
  DeleteRegKey HKCU "Software\Yukino Companion"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Yukino Companion"
SectionEnd
