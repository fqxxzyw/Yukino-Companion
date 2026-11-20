; Older uninstallers recursively remove the installation tree on --updated.
; The electron-builder installUtil hooks bracket that legacy lookup. Point it
; at an unused subkey, then restore the normal registration path before the
; new version writes Add/Remove Programs. Existing registry data is untouched.
!ifndef BUILD_UNINSTALLER
  Var legacyLookupSuffix
  Var finalDirectory
  Var updateStage
  Var rollbackFailed
  !define UNINSTALL_REGISTRY_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}$legacyLookupSuffix"

  !macro customInit
    StrCpy $legacyLookupSuffix "\SkipLegacyUninstall"
  !macroend

  !macro customUnInstallCheck
    ${If} $installMode != "all"
      StrCpy $legacyLookupSuffix ""
      Call prepareUpdateStage
    ${EndIf}
  !macroend

  !macro customUnInstallCheckCurrentUser
    StrCpy $legacyLookupSuffix ""
    Call prepareUpdateStage
  !macroend

  !macro failInstall MESSAGE
    ; An in-app update runs /S after the user confirms. Surface a failure
    ; even though the application that requested the install has exited.
    ${If} ${isForceRun}
      MessageBox MB_ICONSTOP|MB_OK "${MESSAGE}"
    ${EndIf}
    SetErrorLevel 2
    Abort "${MESSAGE}"
  !macroend

  !macro customHeader
    Function prepareUpdateStage
      StrCpy $finalDirectory "$INSTDIR"
      CreateDirectory "$finalDirectory"
      ClearErrors
      GetTempFileName $updateStage "$finalDirectory"
      IfErrors stageUnavailable
      Delete "$updateStage"
      CreateDirectory "$updateStage"
      IfErrors stageUnavailable
      StrCpy $INSTDIR "$updateStage\payload"
      CreateDirectory "$INSTDIR"
      Return
      stageUnavailable:
        !insertmacro failInstall "无法创建更新暂存目录：$finalDirectory。请检查空间和写入权限后重试。"
    FunctionEnd

    ; Only same-volume renames touch installed files. An existing member is
    ; kept in previous/ until every newly extracted member has been committed.
    Function replaceOwnedFile
      Pop $0
      ClearErrors
      IfFileExists "$INSTDIR\$0" 0 moveStaged
        Rename "$INSTDIR\$0" "$updateStage\previous\$0"
        IfErrors lockedMember
      moveStaged:
      Rename "$updateStage\payload\$0" "$INSTDIR\$0"
      Return
      lockedMember:
      SetErrors
    FunctionEnd

    Function restoreOwnedFile
      Pop $0
      ; Missing staged source means replaceOwnedFile committed that member.
      IfFileExists "$updateStage\payload\$0" restorePrevious
      ClearErrors
      Rename "$INSTDIR\$0" "$updateStage\payload\$0"
      IfErrors failedRestore
      restorePrevious:
      IfFileExists "$updateStage\previous\$0" 0 doneRestore
      ClearErrors
      Rename "$updateStage\previous\$0" "$INSTDIR\$0"
      IfErrors failedRestore doneRestore
      failedRestore:
        StrCpy $rollbackFailed 1
      doneRestore:
    FunctionEnd
  !macroend

  !macro verifyStagedFile NAME SIZE
    ClearErrors
    FileOpen $0 "$updateStage\payload\${NAME}" r
    IfErrors rejectStage
    FileSeek $0 0 END $1
    FileClose $0
    StrCmp $1 "${SIZE}" +2
    Goto rejectStage
    ; Never replace a directory (or mount point) with a packaged file.
    IfFileExists "$INSTDIR\${NAME}\*.*" rejectStage
  !macroend

  !macro prepareOwnedDir NAME
    ClearErrors
    CreateDirectory "$INSTDIR\${NAME}"
    IfErrors rejectStage
    StrCpy $0 "$INSTDIR\${NAME}"
    System::Call 'kernel32::GetFileAttributesW(w r0)i.r1'
    IntOp $1 $1 & 0x400
    IntCmp $1 0 +2
    Goto rejectStage
    CreateDirectory "$updateStage\previous\${NAME}"
    IfErrors rejectStage
  !macroend

  ; electron-builder invokes this hook immediately after extraction, before
  ; writing the uninstaller, shortcuts or the new registry version.
  !macro customFiles_x64
    StrCpy $INSTDIR "$finalDirectory"
    SetOutPath "$INSTDIR"
    CreateDirectory "$updateStage\previous"
    !tempfile stageManifest
    !system 'node "${PROJECT_DIR}\scripts\nsis-owned-files.cjs" "${APP_64}" "${stageManifest}" install' = 0
    !include "${stageManifest}"
    !delfile "${stageManifest}"
    !undef stageManifest
    ; A locked or unwritable target stopped the commit. Recover all members
    ; that moved, retaining backups if Windows also refuses a restore.
    StrCmp $rollbackFailed 0 rejectStage
    !insertmacro failInstall "Windows 阻止了回滚。原文件已保存在 $updateStage\previous ，请保留此目录。"
    rejectStage:
      RMDir /r "$updateStage"
      !insertmacro failInstall "更新未能完成，原有应用文件已保留。请检查磁盘空间并关闭占用文件的程序，再运行安装包。"
    stageCommitted:
      IfFileExists "$updateStage\payload\uninstallerIcon.ico" 0 +2
        CopyFiles /SILENT "$updateStage\payload\uninstallerIcon.ico" "$INSTDIR\uninstallerIcon.ico"
      RMDir /r "$updateStage"
  !macroend

  !macro customInstall
    ; electron-builder has just seeded installer.exe with the running installer.
    ; Only carry forward the matching version's map. A standalone installer
    ; may not have one, in which case the app fetches it from the same release.
    SetShellVarContext current
    ${StdUtils.GetParentPath} $0 "$LOCALAPPDATA\${APP_INSTALLER_STORE_FILE}"
    Delete "$0\current.blockmap"
    ${If} ${FileExists} "$EXEPATH.blockmap"
      CopyFiles /SILENT "$EXEPATH.blockmap" "$0\current.blockmap"
    ${EndIf}
    ${If} $installMode == "all"
      SetShellVarContext all
    ${EndIf}
  !macroend
!endif

!macro customRemoveFiles
  ; Remove the files actually shipped by this x64 package. Keep any extra
  ; models, settings or user-selected resource folders, even under resources.
  SetOutPath "$TEMP"
  !tempfile ownedFiles
  !system 'node "${PROJECT_DIR}\scripts\nsis-owned-files.cjs" "${APP_64}" "${ownedFiles}"' = 0
  !include "${ownedFiles}"
  !delfile "${ownedFiles}"
  !undef ownedFiles
  Delete "$INSTDIR\${UNINSTALL_FILENAME}"
  Delete "$INSTDIR\uninstallerIcon.ico"
  RMDir "$INSTDIR"
!macroend
