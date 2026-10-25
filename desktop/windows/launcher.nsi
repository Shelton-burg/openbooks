Unicode true
RequestExecutionLevel user
SilentInstall silent
AutoCloseWindow true
Name "OpenBooks"
OutFile "${OUTPUT}"
!include "FileFunc.nsh"
!include "LogicLib.nsh"
Section
  ${GetParameters} $0
  ${If} $0 != ""
  ${AndIf} $0 != "--controls"
  ${AndIf} $0 != "--stop"
  ${AndIf} $0 != "--startup"
    MessageBox MB_ICONSTOP "Unknown OpenBooks command."
    Quit
  ${EndIf}
  IfFileExists "$EXEDIR\runtime\node.exe" +3 0
    MessageBox MB_ICONSTOP "OpenBooks is incomplete. Run the installer again. Your books are stored separately."
    Quit
  SetOutPath "$EXEDIR"
  nsExec::ExecToStack '"$EXEDIR\runtime\node.exe" "$EXEDIR\desktop\launch.mjs" $0'
  Pop $1
  Pop $2
  ${If} $1 != 0
    MessageBox MB_ICONSTOP "$2"
  ${EndIf}
SectionEnd
