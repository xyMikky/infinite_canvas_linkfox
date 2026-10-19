; 全新安装的数据在 $INSTDIR\data；升级保留已登记的旧数据目录，不重定向为空目录。
; 卸载清数据：优先删除 $INSTDIR\data；旧版若 data-dir 指向自有文件夹，只删应用产生的子项。
; 选「保留数据」时必须用 customRemoveFiles 避开默认的 RMDir /r $INSTDIR，否则 data 仍会被误删。
; Input/Output 另询，且仅清理带 .infinite-canvas-io-dir 标记的已登记目录；拒绝盘符根与盘符下第一层目录。
; 简体中文 NSIS 默认文案是「解除安装」，这里统一改成更常用的「卸载」。

; 顶层 Function 在 !include 本文件时立即解析，必须先加载 LogicLib（${If} 等）；宏体则在展开点解析，不受影响。
!include "LogicLib.nsh"

!macro customHeader
  LangString ^UninstallCaption ${LANG_SIMPCHINESE} "$(^Name) 卸载"
  LangString ^UnComponentsSubCaption ${LANG_SIMPCHINESE} ": 卸载选项"
  LangString ^UnDirSubCaption ${LANG_SIMPCHINESE} ": 卸载文件夹"
  LangString ^UninstallingSubCaption ${LANG_SIMPCHINESE} ": 正在卸载"
  LangString ^UninstallBtn ${LANG_SIMPCHINESE} "卸载(&U)"
  LangString ^ClickUninstall ${LANG_SIMPCHINESE} "单击「卸载」开始卸载。"
  LangString ^UnLicenseText ${LANG_SIMPCHINESE} "在卸载 $(^NameDA) 之前请阅读许可证协议。如果你接受全部条款，单击「我同意」。"
  LangString ^UnLicenseTextCB ${LANG_SIMPCHINESE} "在卸载 $(^NameDA) 之前请阅读许可证协议。如果你接受全部条款，请勾选下方选项。 $_CLICK"
  LangString ^UnLicenseTextRB ${LANG_SIMPCHINESE} "在卸载 $(^NameDA) 之前请阅读许可证协议。如果你接受全部条款，请选择下方第一个选项。 $_CLICK"
  LangString ^UnComponentsText ${LANG_SIMPCHINESE} "勾选你想卸载的组件，取消勾选你不想卸载的组件。 $_CLICK"
  LangString ^UnComponentsSubText1 ${LANG_SIMPCHINESE} "选择卸载类型: "
  LangString ^UnComponentsSubText2_NoInstTypes ${LANG_SIMPCHINESE} "选择要卸载的组件: "
  LangString ^UnComponentsSubText2 ${LANG_SIMPCHINESE} "或选择想要卸载的可选组件: "
  LangString ^DirText ${LANG_SIMPCHINESE} "将安装 $(^NameDA) 到下列文件夹。程序与画布数据在同一位置（数据在其下的 data 子目录）。要安装到其他位置，单击「浏览」。 $_CLICK"
  LangString ^DirSubText ${LANG_SIMPCHINESE} "目标文件夹"
  LangString ^DirBrowseText ${LANG_SIMPCHINESE} "选择要安装 $(^NameDA) 的文件夹: "
  LangString ^UnDirText ${LANG_SIMPCHINESE} "将从下列文件夹卸载 $(^NameDA)。若要更换文件夹，单击「浏览」并另选位置。 $_CLICK"
  LangString ^UnDirBrowseText ${LANG_SIMPCHINESE} "选择要卸载 $(^NameDA) 的文件夹: "
  LangString ^UninstallingText ${LANG_SIMPCHINESE} "这个向导将从你的计算机卸载 $(^NameDA)。 $_CLICK"
  LangString ^UninstallingSubText ${LANG_SIMPCHINESE} "卸载目录: "
  LangString ^CreatedUninstaller ${LANG_SIMPCHINESE} "创建卸载程序: "
  ; 勿再定义 MUI_TEXT_* / MUI_UNTEXT_*：electron-builder 简中语言包已提供，重复会 warning 6030 并导致打包失败。
  ; 安装目录说明已写在上方 ^DirText。
  !ifndef BUILD_UNINSTALLER
    ; 此隐藏节先于 electron-builder 的 install 节执行，旧卸载器尚未运行。
    Section "-保护旧版画布数据"
      InitPluginsDir
      File /oname=$PLUGINSDIR\canvas-data-upgrade.ps1 "${PROJECT_DIR}\electron\nsis\canvas-data-upgrade.ps1"
      ReadRegStr $canvasOldInstall SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" "InstallLocation"
      ReadRegStr $canvasOldData SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" "CanvasDataDir"
      ReadRegStr $canvasUserInstall HKEY_CURRENT_USER "${INSTALL_REGISTRY_KEY}" "InstallLocation"
      ReadRegStr $canvasUserData HKEY_CURRENT_USER "${INSTALL_REGISTRY_KEY}" "CanvasDataDir"
      DetailPrint "正在备份并校验旧版画布数据..."
      nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\canvas-data-upgrade.ps1" -Mode Prepare -InstallDir "$INSTDIR" -RegisteredInstallDir "$canvasOldInstall" -RegisteredDataDir "$canvasOldData" -CurrentUserInstallDir "$canvasUserInstall" -CurrentUserDataDir "$canvasUserData" -StatePath "$PLUGINSDIR\canvas-upgrade-state.json" -BackupRoot "$LOCALAPPDATA\InfiniteCanvas\upgrade-backups"'
      Pop $0
      ${if} $0 != 0
        MessageBox MB_OK|MB_ICONSTOP "旧版数据尚未安全备份，已停止安装，没有卸载旧程序。$\r$\n请先完全关闭无限画布，确认磁盘空间与数据目录权限后重试。$\r$\n详细原因：$PLUGINSDIR\canvas-upgrade-state.json.error.txt"
        Abort
      ${endif}
    SectionEnd
  !endif
!macroend

!ifndef BUILD_UNINSTALLER
Var /GLOBAL canvasOldInstall
Var /GLOBAL canvasOldData
Var /GLOBAL canvasResolvedData
Var /GLOBAL canvasUserInstall
Var /GLOBAL canvasUserData
!macro customInstall
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\canvas-data-upgrade.ps1" -Mode Restore -InstallDir "$INSTDIR" -StatePath "$PLUGINSDIR\canvas-upgrade-state.json" -ResolvedPath "$PLUGINSDIR\canvas-resolved-data.txt"'
  Pop $0
  ${if} $0 != 0
    MessageBox MB_OK|MB_ICONSTOP "安装已停止，尚未启动新程序。旧数据的独立备份仍在：$\r$\n$LOCALAPPDATA\InfiniteCanvas\upgrade-backups$\r$\n请保留备份，检查目录权限后修复。"
    Abort
  ${endif}
  ClearErrors
  FileOpen $0 "$PLUGINSDIR\canvas-resolved-data.txt" r
  FileReadUTF16LE $0 $canvasResolvedData
  FileClose $0
  ${if} ${Errors}
  ${orIf} $canvasResolvedData == ""
    MessageBox MB_OK|MB_ICONSTOP "无法登记原数据目录，已停止安装。请保留 upgrade-backups 目录。"
    Abort
  ${endif}
  WriteRegStr SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" "CanvasDataDir" "$canvasResolvedData"
!macroend
!endif

; 以下全部是卸载器专用逻辑：un.* 函数只能出现在带 un.install 节的编译趟。
!ifdef BUILD_UNINSTALLER
Var /GLOBAL keepInstallData
Var /GLOBAL pathCheckResult

; 覆盖默认 RMDir /r $INSTDIR：升级或选择保留数据时，逐项删除安装文件但跳过 data。
!macro customRemoveFiles
  ${if} ${isUpdated}
  ${orIf} $keepInstallData == "1"
    Call un.RemoveInstallFilesKeepData
  ${else}
    RMDir /r "$INSTDIR"
  ${endif}
!macroend

; 删除 $INSTDIR 下除 data 外的所有内容；不跨卷移动，避免 Rename 失败。
Function un.RemoveInstallFilesKeepData
  Push $0
  Push $1
  Push $2
  Push $3
  Push $4
  Push $5
  StrCpy $5 ""
  ClearErrors
  IfFileExists "$INSTDIR\data-dir-uninstall.txt" 0 keep_read_legacy_pointer
    FileOpen $0 "$INSTDIR\data-dir-uninstall.txt" r
    ${ifNot} ${Errors}
      FileReadUTF16LE $0 $5
      FileClose $0
    ${endif}
    Goto keep_pointer_ready
  keep_read_legacy_pointer:
    FileOpen $0 "$INSTDIR\data-dir.txt" r
    ${ifNot} ${Errors}
      FileRead $0 $5
      FileClose $0
    ${endif}
  keep_pointer_ready:
  ; 旧版若把安装根目录直接作为用户目录，保留整目录比误删用户文件更安全。
  StrCmp $5 "$INSTDIR" keep_data_return
  FindFirst $0 $1 "$INSTDIR\*"
  keep_data_loop:
    StrCmp $1 "" keep_data_done
    StrCmp $1 "." keep_data_next
    StrCmp $1 ".." keep_data_next
    StrCmp $1 "data" keep_data_next
    StrCmp $1 "data-dir.txt" keep_data_next
    StrCmp $1 "data-dir-uninstall.txt" keep_data_next
    StrCmp $1 "io-paths.txt" keep_data_next
    StrCpy $2 "$INSTDIR\$1"
    StrCmp $5 $2 keep_data_next
    StrLen $3 "$2\"
    StrCpy $4 $5 $3
    StrCmp $4 "$2\" keep_data_next
    IfFileExists "$INSTDIR\$1\*.*" 0 keep_data_del_file
      RMDir /r "$INSTDIR\$1"
      Goto keep_data_next
    keep_data_del_file:
      Delete "$INSTDIR\$1"
  keep_data_next:
    FindNext $0 $1
    Goto keep_data_loop
  keep_data_done:
  FindClose $0
  ; data 为空或不存在时顺带清掉空安装目录
  RMDir "$INSTDIR\data"
  RMDir "$INSTDIR"
  keep_data_return:
  Pop $5
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Pop $0
FunctionEnd

!macro customUnInstall
  StrCpy $keepInstallData "1"
  ${ifNot} ${isUpdated}
    ${IfNot} ${Silent}
      MessageBox MB_YESNO|MB_ICONQUESTION \
        "是否同时删除本地用户数据？$\r$\n$\r$\n包括画布项目、API 配置、素材等（通常在安装目录下的 data 文件夹）。$\r$\n选择「否」可在重装后保留这些数据。$\r$\n$\r$\n不会清空安装目录外你自有文件夹里的无关文件。" \
        /SD IDNO IDYES delete_user_data IDNO keep_user_data
      delete_user_data:
        StrCpy $keepInstallData "0"
        ClearErrors
        IfFileExists "$INSTDIR\data-dir-uninstall.txt" 0 read_legacy_data_pointer
          FileOpen $0 "$INSTDIR\data-dir-uninstall.txt" r
          ${ifNot} ${Errors}
            FileReadUTF16LE $0 $1
            FileClose $0
          ${endif}
          Goto data_pointer_loaded
        read_legacy_data_pointer:
        FileOpen $0 "$INSTDIR\data-dir.txt" r
        ${ifNot} ${Errors}
          FileRead $0 $1
          FileClose $0
        ${endif}
        data_pointer_loaded:
        ${ifNot} ${Errors}
          trim_data_dir_nl:
            StrCpy $2 "$1" "" -1
            ${if} $2 == "$\r"
            ${orIf} $2 == "$\n"
            ${orIf} $2 == "\"
              StrCpy $1 "$1" -1
              Goto trim_data_dir_nl
            ${endif}
          ${if} $1 != ""
            Push $1
            Call un.IsUnsafeWipePath
            Pop $9
            ${if} $9 == "1"
              Goto after_data_dir_wipe
            ${endif}
            StrLen $2 "$1"
            ${if} $2 > 3
              StrCpy $6 "0"
              ${if} $1 == "$INSTDIR\data"
                StrCpy $6 "1"
              ${endif}
              ; 旧版专用目录：必须有 userdata 标记，且目录名是应用名或以 \data 结尾
              IfFileExists "$1\.infinite-canvas-userdata" 0 skip_named_data_wipe
                StrLen $3 "\${APP_FILENAME}"
                ${if} $2 >= $3
                  IntOp $4 $2 - $3
                  StrCpy $5 "$1" "" $4
                  ${if} $5 == "\${APP_FILENAME}"
                    StrCpy $6 "1"
                  ${endif}
                ${endif}
                !ifdef APP_PRODUCT_FILENAME
                  StrLen $3 "\${APP_PRODUCT_FILENAME}"
                  ${if} $2 >= $3
                    IntOp $4 $2 - $3
                    StrCpy $5 "$1" "" $4
                    ${if} $5 == "\${APP_PRODUCT_FILENAME}"
                      StrCpy $6 "1"
                    ${endif}
                  ${endif}
                !endif
                StrLen $3 "\data"
                ${if} $2 >= $3
                  IntOp $4 $2 - $3
                  StrCpy $5 "$1" "" $4
                  ${if} $5 == "\data"
                    Push $1
                    Call un.IsShallowDrivePath
                    Pop $9
                    ${if} $9 != "1"
                      StrCpy $6 "1"
                    ${endif}
                  ${endif}
                ${endif}
              skip_named_data_wipe:
              ${if} $6 == "1"
                RMDir /r "$1"
              ${else}
                RMDir /r "$1\canvas-data"
                RMDir /r "$1\IndexedDB"
                RMDir /r "$1\Local Storage"
                RMDir /r "$1\Session Storage"
                RMDir /r "$1\Cache"
                RMDir /r "$1\Code Cache"
                RMDir /r "$1\GPUCache"
                RMDir /r "$1\DawnCache"
                RMDir /r "$1\blob_storage"
                RMDir /r "$1\Network"
                RMDir /r "$1\Partitions"
                RMDir /r "$1\Shared Dictionary"
                RMDir /r "$1\SharedStorage"
                RMDir /r "$1\VideoDecodeStats"
                RMDir /r "$1\WebStorage"
                RMDir /r "$1\Dictionaries"
                RMDir /r "$1\logs"
                RMDir /r "$1\sentry"
                Delete "$1\Preferences"
                Delete "$1\Local State"
                Delete "$1\Cookies"
                Delete "$1\Cookies-journal"
                Delete "$1\Network Persistent State"
                Delete "$1\TransportSecurity"
                Delete "$1\.infinite-canvas-userdata"
              ${endif}
            ${endif}
          ${endif}
        ${endif}
        after_data_dir_wipe:
        ${if} $installMode == "all"
          SetShellVarContext current
        ${endif}
        RMDir /r "$APPDATA\${APP_FILENAME}"
        !ifdef APP_PRODUCT_FILENAME
          RMDir /r "$APPDATA\${APP_PRODUCT_FILENAME}"
        !endif
        !ifdef APP_PACKAGE_NAME
          RMDir /r "$APPDATA\${APP_PACKAGE_NAME}"
        !endif
        RMDir /r "$LOCALAPPDATA\${APP_FILENAME}"
        !ifdef APP_PRODUCT_FILENAME
          RMDir /r "$LOCALAPPDATA\${APP_PRODUCT_FILENAME}"
        !endif
        !ifdef APP_PACKAGE_NAME
          RMDir /r "$LOCALAPPDATA\${APP_PACKAGE_NAME}"
        !endif
        ${if} $installMode == "all"
          SetShellVarContext all
        ${endif}
      keep_user_data:

      ${if} $installMode == "all"
        SetShellVarContext current
      ${endif}
      StrCpy $R9 ""
      IfFileExists "$INSTDIR\io-paths.txt" 0 check_profile_io_reg
        StrCpy $R9 "$INSTDIR\io-paths.txt"
        Goto ask_io_cleanup
      check_profile_io_reg:
      IfFileExists "$PROFILE\.infinite-canvas\io-paths.txt" 0 check_userdata_io_reg
        StrCpy $R9 "$PROFILE\.infinite-canvas\io-paths.txt"
        Goto ask_io_cleanup
      check_userdata_io_reg:
      ClearErrors
      FileOpen $0 "$INSTDIR\data-dir.txt" r
      ${ifNot} ${Errors}
        FileRead $0 $1
        FileClose $0
        trim_io_reg_nl:
          StrCpy $2 "$1" "" -1
          ${if} $2 == "$\r"
          ${orIf} $2 == "$\n"
            StrCpy $1 "$1" -1
            Goto trim_io_reg_nl
          ${endif}
        ${if} $1 != ""
          IfFileExists "$1\io-paths.txt" 0 skip_io_dirs
            StrCpy $R9 "$1\io-paths.txt"
            Goto ask_io_cleanup
        ${endif}
      ${endif}
      Goto skip_io_dirs
      ask_io_cleanup:
      MessageBox MB_YESNO|MB_ICONQUESTION \
        "是否一并清理 Input / Output 目录？$\r$\n$\r$\n仅清理带「.infinite-canvas-io-dir」标记、且由本应用登记过的目录。$\r$\n将删除该目录内的全部内容；盘符根、盘符下第一层文件夹（如 D:\某文件夹）与系统目录一律不删。$\r$\n$\r$\n默认选「否」。" \
        /SD IDNO IDYES clean_io_dirs IDNO skip_io_dirs
      clean_io_dirs:
        ${if} $R9 != ""
          Push "$R9"
          Call un.ClearMarkedIoPathsFile
        ${endif}
      skip_io_dirs:
      ${if} $installMode == "all"
        SetShellVarContext all
      ${endif}
    ${EndIf}
  ${endif}
!macroend

; 入栈路径 → 出栈 "1" 表示禁止整夹删除（空、过短、系统目录、安装根目录）。保存/恢复用到的寄存器。
Function un.IsUnsafeWipePath
  Exch $R8
  Push $0
  Push $1
  StrCpy $0 "0"
  ${if} $R8 == ""
    StrCpy $0 "1"
    Goto unsafe_done
  ${endif}
  StrLen $1 "$R8"
  ${if} $1 <= 3
    StrCpy $0 "1"
    Goto unsafe_done
  ${endif}
  ${if} $R8 == "$WINDIR"
  ${orIf} $R8 == "$PROGRAMFILES"
  ${orIf} $R8 == "$COMMONFILES"
  ${orIf} $R8 == "$DESKTOP"
  ${orIf} $R8 == "$PROFILE"
  ${orIf} $R8 == "$APPDATA"
  ${orIf} $R8 == "$LOCALAPPDATA"
  ${orIf} $R8 == "$DOCUMENTS"
  ${orIf} $R8 == "$INSTDIR"
    StrCpy $0 "1"
  ${endif}
  unsafe_done:
  StrCpy $pathCheckResult $0
  Pop $1
  Pop $0
  Pop $R8
  Push $pathCheckResult
FunctionEnd

; 入栈路径 → 出栈 "1" 表示形如 D:\name 的盘符下第一层目录。保存/恢复用到的寄存器。
Function un.IsShallowDrivePath
  Exch $R8
  Push $0
  Push $1
  Push $2
  StrCpy $0 "0"
  StrLen $1 "$R8"
  ${if} $1 < 4
    StrCpy $0 "1"
    Goto shallow_done
  ${endif}
  StrCpy $2 "$R8" 1 1
  ${if} $2 != ":"
    Goto shallow_done
  ${endif}
  StrCpy $2 "$R8" 1 2
  ${if} $2 != "\"
    Goto shallow_done
  ${endif}
  StrCpy $2 "$R8" "" 3
  shallow_scan:
    StrLen $1 "$2"
    ${if} $1 == 0
      StrCpy $0 "1"
      Goto shallow_done
    ${endif}
    StrCpy $1 "$2" 1
    ${if} $1 == "\"
      Goto shallow_done
    ${endif}
    StrCpy $2 "$2" "" 1
    Goto shallow_scan
  shallow_done:
  StrCpy $pathCheckResult $0
  Pop $2
  Pop $1
  Pop $0
  Pop $R8
  Push $pathCheckResult
FunctionEnd

Function un.ClearMarkedIoPathsFile
  Exch $R7
  Push $0
  Push $1
  Push $2
  ClearErrors
  FileOpen $0 "$R7" r
  ${ifNot} ${Errors}
    FileRead $0 $1
    FileRead $0 $2
    FileClose $0
    Push $1
    Call un.ClearOneMarkedIoDir
    Push $2
    Call un.ClearOneMarkedIoDir
  ${endif}
  Pop $2
  Pop $1
  Pop $0
  Pop $R7
FunctionEnd

Function un.ClearOneMarkedIoDir
  Exch $R8
  Push $0
  Push $1
  trim_one_io_nl:
    StrCpy $0 "$R8" "" -1
    ${if} $0 == "$\r"
    ${orIf} $0 == "$\n"
    ${orIf} $0 == "\"
      StrCpy $R8 "$R8" -1
      Goto trim_one_io_nl
    ${endif}
  ${if} $R8 == ""
    Goto clear_one_io_done
  ${endif}
  Push $R8
  Call un.IsUnsafeWipePath
  Pop $0
  ${if} $0 == "1"
    Goto clear_one_io_done
  ${endif}
  Push $R8
  Call un.IsShallowDrivePath
  Pop $0
  ${if} $0 == "1"
    Goto clear_one_io_done
  ${endif}
  IfFileExists "$R8\.infinite-canvas-io-dir" 0 clear_one_io_done
    RMDir /r "$R8"
  clear_one_io_done:
  Pop $1
  Pop $0
  Pop $R8
FunctionEnd
!endif
