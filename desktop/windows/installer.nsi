Unicode true
RequestExecutionLevel user
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "x64.nsh"
!include "WinVer.nsh"
Name "TradeDesk Books Community"
OutFile "${OUTPUT}"
InstallDir "$LOCALAPPDATA\Programs\TradeDesk Books"
InstallDirRegKey HKCU "Software\TradeDeskBooksCommunity" "InstallDir"
SetCompressor /SOLID lzma
SetCompressorDictSize 32
VIProductVersion "0.1.0.2"
VIAddVersionKey "ProductName" "TradeDesk Books Community"
VIAddVersionKey "FileDescription" "TradeDesk Books Windows beta installer"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "TradeDesk Books contributors"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TEXT "Install TradeDesk Books for your Windows account.$\r$\n$\r$\nEverything needed to run the app is included. It opens in your browser and stores your private books on this computer.$\r$\n$\r$\nThis is an unsigned beta for pilot testing. Keep your current accounting system while testing."
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "${PAYLOAD}\LICENSE"
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN "$INSTDIR\TradeDesk Books.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Open TradeDesk Books and set up my account"
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"
Function .onInit
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP "This installer requires 64-bit Windows."
    Abort
  ${EndIf}
  ${IfNot} ${AtLeastWin10}
    MessageBox MB_ICONSTOP "This installer requires Windows 10 or newer. Windows 11 is recommended."
    Abort
  ${EndIf}
FunctionEnd
Section "TradeDesk Books (required)" Main
  SectionIn RO
  SetShellVarContext current
  ; Before replacing code, the existing version stops and verifies a full backup.
  IfFileExists "$INSTDIR\runtime\node.exe" 0 fresh
    nsExec::ExecToStack '"$INSTDIR\runtime\node.exe" "$INSTDIR\desktop\run.mjs" --before-update'
    Pop $0
    Pop $1
    ${If} $0 != 0
      MessageBox MB_ICONSTOP "TradeDesk Books could not complete its pre-update backup or stop.$\r$\nNo application files have been changed.$\r$\n$1"
      Abort
    ${EndIf}
  fresh:
  SetOutPath "$INSTDIR"
  File /r "${PAYLOAD}\*"
  IfErrors 0 +3
    MessageBox MB_ICONSTOP "Installation could not finish. Your data is retained. Free disk space and run the installer again."
    Abort
  WriteRegStr HKCU "Software\TradeDeskBooksCommunity" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "Software\TradeDeskBooksCommunity" "Version" "${VERSION}"
  CreateDirectory "$SMPROGRAMS\TradeDesk Books"
  CreateShortCut "$SMPROGRAMS\TradeDesk Books\TradeDesk Books.lnk" "$INSTDIR\TradeDesk Books.exe"
  CreateShortCut "$SMPROGRAMS\TradeDesk Books\Desktop controls and backups.lnk" "$INSTDIR\TradeDesk Books.exe" "--controls"
  CreateShortCut "$SMPROGRAMS\TradeDesk Books\Stop TradeDesk Books.lnk" "$INSTDIR\TradeDesk Books.exe" "--stop"
  CreateShortCut "$SMPROGRAMS\TradeDesk Books\Windows guide.lnk" "$INSTDIR\WINDOWS-START-HERE.html"
  CreateShortCut "$DESKTOP\TradeDesk Books.lnk" "$INSTDIR\TradeDesk Books.exe"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "TradeDeskBooksCommunity"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\TradeDeskBooksCommunity" "DisplayName" "TradeDesk Books Community"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\TradeDeskBooksCommunity" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\TradeDeskBooksCommunity" "UninstallString" '$\"$INSTDIR\Uninstall.exe$\"'
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\TradeDeskBooksCommunity" "DisplayIcon" "$INSTDIR\TradeDesk Books.exe"
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\TradeDeskBooksCommunity" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\TradeDeskBooksCommunity" "NoRepair" 1
SectionEnd
Section /o "Start quietly when I sign in to Windows" Startup
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "TradeDeskBooksCommunity" '$\"$INSTDIR\TradeDesk Books.exe$\" --startup'
SectionEnd
Section "Uninstall"
  SetShellVarContext current
  nsExec::ExecToStack '"$INSTDIR\runtime\node.exe" "$INSTDIR\desktop\run.mjs" --stop'
  Pop $0
  Pop $1
  ${If} $0 != 0
    MessageBox MB_ICONSTOP "Close TradeDesk Books before uninstalling.$\r$\n$1"
    Abort
  ${EndIf}
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "TradeDeskBooksCommunity"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\TradeDeskBooksCommunity"
  DeleteRegKey HKCU "Software\TradeDeskBooksCommunity"
  Delete "$DESKTOP\TradeDesk Books.lnk"
  RMDir /r "$SMPROGRAMS\TradeDesk Books"
  ; Delete only known installed application paths. NEVER remove the data root.
  RMDir /r "$INSTDIR\app"
  RMDir /r "$INSTDIR\runtime"
  RMDir /r "$INSTDIR\desktop"
  RMDir /r "$INSTDIR\server"
  RMDir /r "$INSTDIR\vendor"
  Delete "$INSTDIR\TradeDesk Books.exe"
  Delete "$INSTDIR\release.json"
  Delete "$INSTDIR\LICENSE"
  Delete "$INSTDIR\THIRD_PARTY_NOTICES.md"
  Delete "$INSTDIR\WINDOWS-START-HERE.html"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
  MessageBox MB_ICONINFORMATION "Application removed. Books, receipts and backups have been kept in:$\r$\n$LOCALAPPDATA\TradeDesk Books"
SectionEnd
